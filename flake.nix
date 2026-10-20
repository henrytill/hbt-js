{
  inputs = {
    self.submodules = true;
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    utils.url = "github:numtide/flake-utils";
    # hbt-data's own flake, read from the corpus submodule: a relative path
    # input locks relative to this flake, not by hash, so the submodule stays
    # the one pin on the harness and the corpus it checks.
    hbt-data = {
      url = "path:./test/data";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.flake-utils.follows = "utils";
    };
  };
  outputs =
    {
      self,
      nixpkgs,
      utils,
      hbt-data,
    }:
    utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        inherit (pkgs) lib;
        rootPackage = lib.importJSON (self + "/package.json");
        # A workspace package: its directory, and what its package.json
        # says of it.
        workspace =
          dir:
          let
            package = lib.importJSON (self + "/${dir}/package.json");
          in
          {
            inherit dir;
            inherit (package) name version;
            dependencies = package.dependencies or { };
          };
        workspaces = map workspace rootPackage.workspaces;
        cli = workspace "packages/hbt-cli";
        # The manifests and the lockfile, and nothing else, so what is
        # built from them alone is rebuilt when they change and not on
        # every edit.
        manifests = lib.fileset.toSource {
          root = ./.;
          fileset = lib.fileset.unions (
            [
              ./package.json
              ./package-lock.json
            ]
            ++ map (w: ./. + "/${w.dir}/package.json") workspaces
          );
        };
        # The dev shell's package.json and lockfile: the workspaces'
        # dependencies made the root's, and the workspaces themselves
        # gone, which the shell links into the working tree instead.
        # Nix only names the dependencies; npm edits package.json and
        # rewrites the lockfile, offline, from the entries it already
        # has, and fails rather than resolve a range none of them
        # satisfies. A copy npm nested under one workspace, because the
        # two need versions no one copy satisfies, is the case it would
        # not catch: the root can hold only one, so it is refused here.
        devManifests =
          let
            names = map (w: w.name) workspaces;
            dependencies = removeAttrs (lib.foldl' (acc: w: acc // w.dependencies) { } workspaces) names;
          in
          pkgs.runCommand "hbt-dev-manifests" { nativeBuildInputs = [ pkgs.nodejs ]; } ''
            cp -r --no-preserve=mode ${manifests}/. .
            export HOME=$TMPDIR npm_config_cache=$TMPDIR/npm-cache
            if grep -q '"packages/[^"]*/node_modules/' package-lock.json; then
              echo "a workspace has a nested dependency, which the dev shell cannot flatten" >&2
              exit 1
            fi
            npm pkg delete workspaces
            npm pkg set ${lib.escapeShellArgs (lib.mapAttrsToList (n: v: "dependencies.${n}=${v}") dependencies)}
            rm -r packages
            npm install --package-lock-only --offline --ignore-scripts --no-audit --no-fund
            mkdir $out
            cp package.json package-lock.json $out
          '';
        hbt = pkgs.buildNpmPackage {
          pname = "hbt";
          inherit (cli) version;
          src = self;

          npmDeps = pkgs.importNpmLock { npmRoot = self; };

          npmConfigHook = pkgs.importNpmLock.npmConfigHook;

          # npmInstallHook installs a workspace that imports none of the
          # others: given npmWorkspace, it would build and prune that one
          # alone, and copy node_modules with links to the rest that
          # dangle in the output. So the install is this one, as
          # `npm install -g` of the CLI's tarball would lay it out: the
          # CLI at lib/node_modules/<its name>, its production
          # dependencies beside it, and in place of the link to each
          # other workspace the tarball npm would publish of it. The
          # packs skip prepack, which would rebuild with tsc pruned;
          # npmBuildHook has just built from clean.
          installPhase = ''
            runHook preInstall

            npm prune --omit=dev --no-save
            find node_modules -maxdepth 1 -type d -empty -delete

            pack=$(mktemp -d)
            # Unpacks the tarball npm would publish of workspace $1 into $2.
            unpack() {
              mkdir -p "$2"
              tar -xzf "$pack/$(npm pack --ignore-scripts --loglevel=warn --workspace="$1" --pack-destination "$pack")" \
                --strip-components=1 -C "$2"
            }

            packageOut=$out/lib/node_modules/${cli.name}
            unpack ${cli.dir} "$packageOut"
            cp -r node_modules "$packageOut/node_modules"
            rm -r "$packageOut/node_modules/.bin"
            # npm's relative links to the workspaces, dangling here.
            rm ${toString (map (w: "$packageOut/node_modules/${w.name}") workspaces)}
            ${lib.concatMapStrings (w: ''
              unpack ${w.dir} "$packageOut/node_modules/${w.name}"
            '') (lib.filter (w: w.dir != cli.dir) workspaces)}
            (cd ${cli.dir} && nodejsInstallExecutables)

            # The commit `hbt --version` prints, from the variable
            # hbt-rs's flake bakes in. Reading self's revision is what
            # makes a `path:` reference to this flake fail to evaluate,
            # as it does for hbt-rs.
            wrapProgram $out/bin/hbt \
              --set HBT_COMMIT_SHORT_HASH ${self.shortRev or self.dirtyShortRev}

            runHook postInstall
          '';

          meta.mainProgram = "hbt";
        };
      in
      {
        packages.default = hbt;
        checks = {
          conformance = hbt-data.lib.${system}.check {
            binary = lib.getExe hbt;
            waivers = ./conformance.waivers;
          };
        }
        # nixpkgs' chromium is Linux-only, and an unsupported package
        # fails evaluation of every check, so darwin skips this one.
        // lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
          # The unit tests again, in headless Chromium, by the script
          # `npm run test:browser` runs, against the tests this build
          # bundled for the browser.
          browser = hbt.overrideAttrs (old: {
            pname = "hbt-browser-check";
            nativeBuildInputs = old.nativeBuildInputs ++ [ pkgs.chromium ];
            installPhase = ''
              node test-browser.mjs
              touch $out
            '';
          });
        };
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            hbt-data.packages.${system}.python
            importNpmLock.hooks.linkNodeModulesHook
            nodejs
          ];
          # Read from devManifests' output, so evaluating the shell
          # builds it first: importNpmLock needs the lockfile at
          # evaluation time. The links to the workspaces point into the
          # working tree, so the shell makes them, and
          # linkNodeModulesHook, which manages only links into the store,
          # leaves them be.
          npmDeps = pkgs.importNpmLock.buildNodeModules {
            package = lib.importJSON "${devManifests}/package.json";
            packageLock = lib.importJSON "${devManifests}/package-lock.json";
            inherit (pkgs) nodejs;
            # Rather than the root package.json's name, whose scope would
            # start the store path with a dash.
            derivationArgs.pname = "hbt-node-modules";
          };
          postShellHook = lib.concatMapStrings (w: ''
            mkdir -p node_modules/${dirOf w.name}
            ln -sfnr ${w.dir} node_modules/${w.name}
          '') workspaces;
        };
      }
    );
}

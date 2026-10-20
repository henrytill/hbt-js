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
        src = self;
        npmRoot = self;
        rootPackage = lib.importJSON (self + "/package.json");
        # A workspace package, by directory and by name.
        workspace = dir: {
          inherit dir;
          inherit (lib.importJSON (self + "/${dir}/package.json")) name;
        };
        workspaces = map workspace rootPackage.workspaces;
        cli = workspace "packages/hbt-cli";
        # npm links each workspace package into node_modules by a
        # relative link into packages/, which neither the store copy of
        # node_modules below nor the package's has beside it. The scope
        # directory goes too once empty, or linkNodeModulesHook would
        # link it into the store, where the shell cannot add to it.
        rmWorkspaceLinks =
          nodeModules:
          let
            links = map (w: "${nodeModules}/${w.name}") workspaces;
          in
          ''
            rm ${lib.concatStringsSep " " links}
            rmdir --ignore-fail-on-non-empty ${lib.concatStringsSep " " (lib.unique (map dirOf links))}
            rm -f ${nodeModules}/.bin/hbt
          '';
        hbt = pkgs.buildNpmPackage {
          pname = "hbt";
          version = "0.1.0";
          inherit src;

          npmDeps = pkgs.importNpmLock { inherit npmRoot; };

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
          #
          # The commit `hbt --version` prints, from the variable hbt-rs's
          # flake bakes in. Reading self's revision is what makes a
          # `path:` reference to this flake fail to evaluate, as it does
          # for hbt-rs.
          installPhase = ''
            runHook preInstall

            npm prune --omit=dev --no-save
            find node_modules -maxdepth 1 -type d -empty -delete

            pack=$(mktemp -d)
            # Unpacks the tarball npm would publish of workspace $1 into $2.
            unpack() {
              mkdir -p "$pack/$1" "$2"
              npm pack --ignore-scripts --loglevel=warn --workspace="$1" --pack-destination "$pack/$1" >/dev/null
              tar -xzf "$pack/$1"/*.tgz --strip-components=1 -C "$2"
            }

            packageOut=$out/lib/node_modules/${cli.name}
            unpack ${cli.dir} "$packageOut"
            cp -r node_modules "$packageOut/node_modules"
            rm -r "$packageOut/node_modules/.bin"
            ${rmWorkspaceLinks "$packageOut/node_modules"}
            ${lib.concatMapStrings (w: ''
              unpack ${w.dir} "$packageOut/node_modules/${w.name}"
            '') (lib.filter (w: w.dir != cli.dir) workspaces)}
            (cd ${cli.dir} && nodejsInstallExecutables)

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
            binary = pkgs.lib.getExe hbt;
            waivers = ./conformance.waivers;
          };
        }
        # nixpkgs' chromium is Linux-only, and an unsupported package
        # fails evaluation of every check, so darwin skips this one.
        // pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
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
          # buildNodeModules installs from package.json and the lockfile
          # alone, and npm skips a workspace whose directory it cannot
          # see, dependencies and all; given each one's package.json, it
          # installs their dependencies. The links to the workspaces
          # themselves must point into the working tree, so the shell
          # makes them, and linkNodeModulesHook, which manages only
          # links into the store, leaves them be.
          #
          # Its npmRoot holds only the manifests and the lockfile, so the
          # shell's node_modules is rebuilt when they change and not on
          # every edit: importNpmLock resolves each workspace's lock entry
          # against npmRoot too, which with the whole tree would make the
          # tree an input.
          npmDeps = pkgs.importNpmLock.buildNodeModules rec {
            npmRoot = lib.fileset.toSource {
              root = ./.;
              fileset = lib.fileset.unions (
                [
                  ./package.json
                  ./package-lock.json
                ]
                ++ map (w: ./. + "/${w.dir}/package.json") workspaces
              );
            };
            inherit (pkgs) nodejs;
            derivationArgs = {
              # Rather than the root package.json's name, whose scope
              # would start the store path with a dash.
              pname = "hbt-node-modules";
              postPatch = lib.concatMapStrings (w: ''
                install -D -m 644 ${npmRoot}/${w.dir}/package.json ${w.dir}/package.json
              '') workspaces;
              postInstall = rmWorkspaceLinks "$out/node_modules";
            };
          };
          postShellHook = lib.concatMapStrings (w: ''
            mkdir -p node_modules/${dirOf w.name}
            ln -sfnr ${w.dir} node_modules/${w.name}
          '') workspaces;
        };
      }
    );
}

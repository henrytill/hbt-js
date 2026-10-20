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
        cliDir = "packages/hbt-cli";
        cli = lib.importJSON (self + "/${cliDir}/package.json");
        hbt = pkgs.stdenv.mkDerivation (finalAttrs: {
          pname = "hbt";
          inherit (cli) version;
          src = self;

          nativeBuildInputs = [
            pkgs.nodejs
            pkgs.pnpm
            pkgs.pnpmConfigHook
            pkgs.pnpmBuildHook
            pkgs.makeWrapper
          ];
          # Named here, not from finalAttrs, so that the browser check,
          # which renames the package, shares this fetch.
          pnpmDeps = pkgs.fetchPnpmDeps {
            pname = "hbt";
            inherit (finalAttrs) version src;
            fetcherVersion = 4;
            hash = "sha256-TbpK2jUbR4GhgC5y/ZkY4OVNi74WK9x2EihkXsJS7vo=";
          };

          installPhase = ''
            runHook preInstall
            packageOut=$out/lib/node_modules/${cli.name}
            pnpm --filter ${cli.name} deploy --prod --offline "$packageOut"
            # deploy leaves pnpm's own records, one stamped with the time
            # of the build, and rewrites package.json to depend on the
            # library by its path in the build.
            rm -r "$packageOut"/{pnpm-lock.yaml,pnpm-workspace.yaml} \
              "$packageOut"/node_modules/{.bin,.modules.yaml,.pnpm-workspace-state-v1.json,.pnpm/lock.yaml}
            install -m 644 ${cliDir}/package.json "$packageOut"/package.json
            # The commit `hbt --version` prints, from the variable
            # hbt-rs's flake bakes in. Reading self's revision is what
            # makes a `path:` reference to this flake fail to evaluate,
            # as it does for hbt-rs.
            makeWrapper ${lib.getExe pkgs.nodejs} $out/bin/hbt \
              --add-flags "$packageOut/${cli.bin.hbt}" \
              --set HBT_COMMIT_SHORT_HASH ${self.shortRev or self.dirtyShortRev}
            runHook postInstall
          '';

          meta.mainProgram = "hbt";
        });
        # The store fetchPnpmDeps fetched, unpacked once for the dev
        # shell to install from, as pnpmConfigHook unpacks it in the
        # build; read-only is enough for an offline install.
        pnpmStore =
          pkgs.runCommand "hbt-pnpm-store"
            {
              nativeBuildInputs = [
                pkgs.sqlite
                pkgs.zstd
              ];
            }
            ''
              mkdir $out
              tar --zstd -xf ${hbt.pnpmDeps}/pnpm-store.tar.zst -C $out
              # Kept as SQL by fetchPnpmDeps, since the database file is not
              # reproducible; the layout is fetcherVersion 4's.
              chmod u+w $out/v11
              sqlite3 $out/v11/index.db < $out/v11/index.db.sql
              rm $out/v11/index.db.sql
            '';
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
          # `pnpm run test:browser` runs, against the tests this build
          # bundled for the browser.
          browser = hbt.overrideAttrs (old: {
            pname = "hbt-browser-check";
            nativeBuildInputs = old.nativeBuildInputs ++ [ pkgs.chromium ];
            installPhase = ''
              node scripts/test-browser.mjs
              touch $out
            '';
          });
        };
        devShells.default = pkgs.mkShell {
          packages = [
            hbt-data.packages.${system}.python
            pkgs.nodejs
            pkgs.pnpm
          ];
          # Not pnpmConfigHook, which is for the sandbox; AGENTS.md
          # says why. pnpm finds the workspace root from any directory
          # in the checkout, but outside it would start a project where
          # it stands, or install another workspace, so the hook checks
          # that the root it finds is this one.
          shellHook = ''
            if root=$(pnpm root -w 2>/dev/null) &&
              [ "$(node -p "require('$root/../package.json').name" 2>/dev/null)" = ${(lib.importJSON ./package.json).name} ]; then
              pnpm install --offline --frozen-lockfile --trust-lockfile \
                --store-dir=${pnpmStore} --package-import-method=copy --reporter=silent
            else
              echo "Not in the hbt-js checkout, so not installing node_modules" >&2
            fi
          '';
        };
      }
    );
}

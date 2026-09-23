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
        src = self;
        npmRoot = self;
        hbt = pkgs.buildNpmPackage {
          pname = "hbt";
          version = "0.1.0";
          inherit src;

          npmDeps = pkgs.importNpmLock { inherit npmRoot; };

          npmConfigHook = pkgs.importNpmLock.npmConfigHook;
        };
      in
      {
        packages.default = hbt;
        checks.conformance = hbt-data.lib.${system}.check {
          binary = "${hbt}/bin/hbt";
          waivers = ./conformance.waivers;
        };
        # The unit tests again, in headless Chromium, by the script
        # `npm run test:browser` runs, against the tests this build
        # bundled for the browser.
        checks.browser = hbt.overrideAttrs (old: {
          pname = "hbt-browser-check";
          nativeBuildInputs = old.nativeBuildInputs ++ [ pkgs.chromium ];
          installPhase = ''
            node test/browser/run.mjs
            touch $out
          '';
        });
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            hbt-data.packages.${system}.python
            importNpmLock.hooks.linkNodeModulesHook
            nodejs
          ];
          npmDeps = pkgs.importNpmLock.buildNodeModules {
            inherit npmRoot;
            inherit (pkgs) nodejs;
          };
        };
      }
    );
}

{
  description = "Playwright-style E2E test driver for React Native";

  inputs = {
    # Track the latest stable release channel: recent tool versions AND fully
    # Hydra-built/cached for darwin. nixpkgs-unstable lags on darwin for some
    # packages, which forces slow source builds; stable avoids that trap.
    nixpkgs.url = "github:nixos/nixpkgs/nixos-26.05";
    flake-utils.url = "github:numtide/flake-utils";

    # bun-overlay supplies an official-binary `bun` that shadows nixpkgs'.
    bun-overlay = {
      url = "github:0xbigboss/bun-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
      inputs.flake-utils.follows = "flake-utils";
    };

    # Used for shell.nix
    flake-compat = {
      url = "github:edolstra/flake-compat";
      flake = false;
    };
  };

  outputs = {
    self,
    nixpkgs,
    flake-utils,
    bun-overlay,
    ...
  } @ inputs: let
    overlays = [
      bun-overlay.overlays.default
    ];

    systems = ["x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin"];
  in
    flake-utils.lib.eachSystem systems (
      system: let
        pkgs = import nixpkgs {
          inherit overlays system;
        };
      in {
        formatter = pkgs.alejandra;

        devShells.default = pkgs.mkShell {
          name = "rn-playwright-driver-dev";
          nativeBuildInputs = [
            pkgs.bun
            pkgs.fnm
            pkgs.jq
            pkgs.ripgrep
            pkgs.coreutils
            pkgs.lefthook
          ];
          shellHook =
            ''
              eval "$(fnm env --use-on-cd --corepack-enabled --shell bash)"
            ''
            + (pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
              export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true
            '')
            + (pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''
              unset SDKROOT
              unset DEVELOPER_DIR
              export PATH=/usr/bin:$PATH
            '');
        };

        devShell = self.devShells.${system}.default;
      }
    );
}

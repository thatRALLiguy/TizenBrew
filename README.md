# 🍺 TizenBrew

<p align="center">
    <img width="700px" src="./.github/assets/TizenBrew_Official_Banner.png">
    <br>
    <sub> TizenBrew logo, banner and README by <a href="https://github.com/Zyborg777">@Zyborg777</a> </sub>
</p>

### Experience your favorite custom apps (such as [TizenTube](https://github.com/reisxd/TizenTube)) in a whole new way!
Thanks to TizenBrew, you can install newer apps without having to deal with Tizen Studio multiple times. Just one click
and you're done 🎊

<p align="center">
    <a href="https://discord.gg/m2P7v8Y2qR">
        <picture>
            <source height="24px" media="(prefers-color-scheme: dark)"
                srcset="https://user-images.githubusercontent.com/13122796/178032563-d4e084b7-244e-4358-af50-26bde6dd4996.png" />
            <img height="24px"
                src="https://user-images.githubusercontent.com/13122796/178032563-d4e084b7-244e-4358-af50-26bde6dd4996.png" />
        </picture>
    </a>&nbsp;&nbsp;&nbsp;
    <a href="https://t.me/tizenbrew">
        <picture>
            <source height="24px" media="(prefers-color-scheme: dark)"
                srcset="https://user-images.githubusercontent.com/13122796/178032213-faf25ab8-0bc3-4a94-a730-b524c96df124.png" />
            <img height="24px"
                src="https://user-images.githubusercontent.com/13122796/178032213-faf25ab8-0bc3-4a94-a730-b524c96df124.png" />
        </picture>
    </a>&nbsp;&nbsp;&nbsp;
    <a href="https://reddit.com/r/TizenTube">
        <picture>
            <source height="24px" media="(prefers-color-scheme: dark)"
                srcset="https://user-images.githubusercontent.com/13122796/178032351-9d9d5619-8ef7-470a-9eec-2744ece54553.png" />
            <img height="24px"
                src="https://user-images.githubusercontent.com/13122796/178032351-9d9d5619-8ef7-470a-9eec-2744ece54553.png" />
        </picture>
    </a>&nbsp;&nbsp;&nbsp;
    <a href="https://www.youtube.com/@tizenbrew">
        <picture>
            <source height="24px" media="(prefers-color-scheme: dark)"
                srcset="https://user-images.githubusercontent.com/13122796/178032714-c51c7492-0666-44ac-99c2-f003a695ab50.png" />
            <img height="24px"
                src="https://user-images.githubusercontent.com/13122796/178032714-c51c7492-0666-44ac-99c2-f003a695ab50.png" />
        </picture>
    </a>
</p>


# 🙌 Getting started

### You can read the [guide](./docs/README.md) down below to get started with TizenBrew ⬇️
<p align="left">
    <a href="./docs/README.md">
        <picture>
            <source height="50px" srcset="./.github/assets/TizenBrew_Guide_Button.png" />
            <img height="50px" src="./.github/assets/TizenBrew_Guide_Button.png" />
        </picture>
    </a>
</p>

# 💻 Making a module

You can read the [guide](./docs/MODULES.md) to make a module for TizenBrew.

# 💬 Translations

You can read the [guide](./docs/TRANSLATION.md) to translate TizenBrew into your native language.
## Development checks

Run `node --test tests/*.test.cjs` from the repository root using Node 22 or newer.
The tests mock Tizen, sockets, the debugger, downloads, and configuration storage;
they do not require a TV or modify TV settings.

Run `npm ci` and `npm run build` in each of these directories:

- `tizenbrew-app/TizenBrew/service-nextgen/service`
- `tizenbrew-app/TizenBrew/tizenbrew-ui`

The UI deliberately aliases React to Preact. Its `.npmrc` permits those peer
version differences; required build peers are explicit and locked. The service
bundler is pinned. Build tools run on modern Node, while the service retains its
Node 4.4.3 WebSocket selection and Babel transpilation, and the UI retains its
Chrome 47 legacy target. Do not raise those runtime targets without TV testing.

Before a release, test on both an older and newer TV: enable/disable service
autostart and restart, launch a document-start module, interrupt the network,
restore it, and verify visible errors and recovery. Automated mocks and builds
cannot verify Samsung APIs, certificates, or actual firmware behavior.

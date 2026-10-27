# Changelog

## [0.9.1](https://github.com/alejandrom2/turnkey/compare/v0.9.1...v0.9.1) (2026-10-27)


### ⚠ BREAKING CHANGES

* the plugin UUID changes, so Stream Deck treats it as a new plugin. Remove the old one, import the profile again and pair each machine once.

### Features

* a Devices page in the bundled profile with Open Preview, Wake and the Devices dial ([c2a2e5c](https://github.com/alejandrom2/turnkey/commit/c2a2e5c42daed617f2d48dd0f5df848a45039bde))
* a model's top effort level stands out in a configurable color ([f9c763c](https://github.com/alejandrom2/turnkey/commit/f9c763cf50844a4fbe6374c44ac8ef4603f2454a))
* a Preview pet button walks the idle pet across the dials once, now ([773d078](https://github.com/alejandrom2/turnkey/commit/773d078505b2f487440e0d0b369eeae935a6876e))
* a thicker state line along the strip's bottom (5 px, full color) ([f5a6215](https://github.com/alejandrom2/turnkey/commit/f5a6215dcf6f47645508ae64290f085b3130738b))
* action panels slim down to their fields, the machine and a T3 Deck Settings window ([7c31795](https://github.com/alejandrom2/turnkey/commit/7c3179531007db7b720dfca0290e7c5fb205ba22))
* Activity and Usage faces for the Stream Deck Neo info bar ([47ea9a5](https://github.com/alejandrom2/turnkey/commit/47ea9a59d6303feda28dea76079ae38360b6c807))
* Curated and All actions profiles for Stream Deck +, Neo, 15-key, XL and Mini ([98070f6](https://github.com/alejandrom2/turnkey/commit/98070f6f5c07cafab86e631c6c45eeef3deb4a24))
* Devices dial starts, opens and powers off T3 Code's simulators and emulators ([82c53f5](https://github.com/alejandrom2/turnkey/commit/82c53f588f6371f3013aae5cb51845903ea54326))
* Diagnostics: 24-hour verbose logging, logs folder and a sanitized export ([fb2c455](https://github.com/alejandrom2/turnkey/commit/fb2c4553d5c157a962371f8b221546b20844bcd2))
* effort gradients follow the model's color ([b429c03](https://github.com/alejandrom2/turnkey/commit/b429c031bff19ea1ca56ff03dcbe82edfc4f6698))
* effort sparkles on the upper half of the ladder, twinkling as Motion allows ([825b03e](https://github.com/alejandrom2/turnkey/commit/825b03e475a20b4d860f9df63d278b20ac15be3e))
* Elgato-parity key states, motion, confirm before sending and Flow strips ([b4f6eda](https://github.com/alejandrom2/turnkey/commit/b4f6eda75f120a50a2fac1ece54a6c963cee3c7a))
* Elgato-parity keys and model switching across favorites ([945a461](https://github.com/alejandrom2/turnkey/commit/945a46192c78324c98ed79171d53272fbdada47c))
* Elgato-style dials, scrolling strip text, Ultrathink and strip appearance ([fe154ff](https://github.com/alejandrom2/turnkey/commit/fe154fffc4d1502c877b662813e8af5d5c9549bc))
* Elgato-style Power slider and Speed key ([5742766](https://github.com/alejandrom2/turnkey/commit/5742766642456d7643f69d6d00662107af5c8d7e))
* follow T3's selection, with availability and press feedback on every key ([3d57389](https://github.com/alejandrom2/turnkey/commit/3d573890ec2e0dee87349d562e9528ccaac0189d))
* Fork and Merge Back keys ([79cc905](https://github.com/alejandrom2/turnkey/commit/79cc90553b1613c3e6b6d0f2b14d699bdd10aebd))
* Fork forks the thread or, held, merges a fork back ([69b9527](https://github.com/alejandrom2/turnkey/commit/69b9527c244e23bea7699dd56411fd469acb8a31))
* German, Spanish and French translations ([9fdad6a](https://github.com/alejandrom2/turnkey/commit/9fdad6a00fe98c31d502329424425a6ae27f0627))
* git keys and the inspector's requirements checklist ([f068155](https://github.com/alejandrom2/turnkey/commit/f068155559e7ae63c4c90295a8c422945f1f85cb))
* gradients for every effort level, model and Fast, and no Speed on the Access dial ([0050960](https://github.com/alejandrom2/turnkey/commit/0050960f5317b7cadc7479d4b4d61f32bf0e2b9c))
* Health shows provider problems, worst first ([8984a08](https://github.com/alejandrom2/turnkey/commit/8984a080563b81bbd293564f1e0c1d3d9144c4e6))
* idle pet scheduler, robot sprite and run placement ([661f033](https://github.com/alejandrom2/turnkey/commit/661f0336c0dca3d502adbe8ac126670554bcdf9c))
* Idle pet setting walks a robot across the dial strips while the deck sits idle ([5777e0d](https://github.com/alejandrom2/turnkey/commit/5777e0dbf3de7b02fcd7a4cbfdcb921587dac9c1))
* inspectors take Stream Deck's language as their HTML lang, so Chinese and Japanese text uses the right glyphs ([67e166f](https://github.com/alejandrom2/turnkey/commit/67e166f93d8098289409e416decdecac4d3d8c8d))
* Japanese, Korean, and Simplified and Traditional Chinese translations ([364f57b](https://github.com/alejandrom2/turnkey/commit/364f57b3c0dd4808b6999036b28f1ee9cba385ee))
* keys can target one thread instead of the selected one ([b96655d](https://github.com/alejandrom2/turnkey/commit/b96655de227a5efdc74b1fe6ef2474cd8ef29aec))
* Limits key and dial show T3 Code's pooled subscription limits, with refresh and resets ([c68c23d](https://github.com/alejandrom2/turnkey/commit/c68c23d9bca7ade4b2912df4ecdc6d6152bf4e72))
* List and Carousel strip styles with vertical text scrolling ([8e898e4](https://github.com/alejandrom2/turnkey/commit/8e898e4cc5a6d57727fc31be6e44aec1df96903d))
* localization groundwork with every string in en.json ([db1f4f6](https://github.com/alejandrom2/turnkey/commit/db1f4f61faf45c67c44823b014abeecf1d804101))
* machine card lists extra access, and un-flags a pending scope ([7dad380](https://github.com/alejandrom2/turnkey/commit/7dad3808c93f7fd44880acf2022663ef742d4722))
* machines read usage, refresh limits and keep the server config live while watched ([5bc80c5](https://github.com/alejandrom2/turnkey/commit/5bc80c596511fbdcd8f2ba41082ebabaec81035d))
* merged actions pick what they do by a mode, and older keys keep theirs ([0d451b4](https://github.com/alejandrom2/turnkey/commit/0d451b4e161443c8dca80ce28b5537c78c6fdb68))
* New Thread can start in a new worktree, with worktree marks and branch status ([3908082](https://github.com/alejandrom2/turnkey/commit/3908082890466295850e02c7f567f7db6a40ecfd))
* no press shows a success card; keys and strips just show the new state ([df7f8ff](https://github.com/alejandrom2/turnkey/commit/df7f8ff67a9128e14394b9f235edef5c309e0abf))
* one Git action commits, pushes, creates a PR or pulls, as its Action setting picks ([a6142f8](https://github.com/alejandrom2/turnkey/commit/a6142f81ac50eb173ce36ce7580b8cdec54b96bd))
* Open in Editor, new actions in the list and profile, and the inspector checklist ([58b2f1b](https://github.com/alejandrom2/turnkey/commit/58b2f1bdc3c28777db4ef279252cba0d94c5cfbb))
* Open opens the thread in an editor or its preview in the browser ([dd73642](https://github.com/alejandrom2/turnkey/commit/dd73642771590a83b4ba9d9c34385fe39a72aee0))
* Open Preview opens the thread's preview page or HTML render here ([8ad4365](https://github.com/alejandrom2/turnkey/commit/8ad43657b8dd03ff62d6f96f7c9c3e457003ac5f))
* opt-in scopes for updates, terminals and guest links ([bb10110](https://github.com/alejandrom2/turnkey/commit/bb10110bd80df95b1c6e64023fc84bc1f21b481d))
* Organize can wake the thread snoozed last ([23a97de](https://github.com/alejandrom2/turnkey/commit/23a97def3a5dbcb61f71fd770bc64ff1f4111577))
* Permissions key shows a mode track, and access wears blue through violet to amber ([6cc2101](https://github.com/alejandrom2/turnkey/commit/6cc2101eb76a394590839dc20af75c88ac6318af))
* port T3 Code's usage merge, limits pooling, formats and refresh throttle ([2abad59](https://github.com/alejandrom2/turnkey/commit/2abad59492e72e910063a07d5387725877b8608d))
* Power dial carousel names every tile on the bottom row, sliding with it ([6e866f9](https://github.com/alejandrom2/turnkey/commit/6e866f9aab483f52a8a5be1f074e6c531778f119))
* Power dial names drop a leading provider word for every provider (Claude Opus 4.7 → Opus 4.7) ([48e537a](https://github.com/alejandrom2/turnkey/commit/48e537ae3a8cc668f5be6f802a849b9c6b191892))
* Power dial tiles name their model, and models take their provider's color ([c33bf7d](https://github.com/alejandrom2/turnkey/commit/c33bf7dfc5e76ef51ed8055a9e6ac31c93a9f6c6))
* Power dial's Press to apply takes the previewed model's color ([1efc9bb](https://github.com/alejandrom2/turnkey/commit/1efc9bb319b679b9160d34a7f64d65770258d2a3))
* pull request actions with T3 Code's Fix findings and Explain handoffs ([ec51914](https://github.com/alejandrom2/turnkey/commit/ec519142c7c851d95c1c2f9d1b10b000f63be992))
* Pull Request shows the thread's PR or hands it to an agent: fix findings, explain, ask or a review guide ([5905559](https://github.com/alejandrom2/turnkey/commit/59055599294b16d41224b7854eec711e4accb434))
* queued counts on thread keys and a Queue dial ([784365f](https://github.com/alejandrom2/turnkey/commit/784365fd853850abec6955de04814937afdf17e2))
* rename to Turnkey for T3 Code, under the MIT license ([fb10b58](https://github.com/alejandrom2/turnkey/commit/fb10b58e611c84434240b498ecb6216f4c65d0f6))
* request diagnostics and source control scopes, track grants per machine ([968ed83](https://github.com/alejandrom2/turnkey/commit/968ed8360e388d4a00d5cff7050aa6ca3361058f))
* Run Skill key and Skills dial for the thread's provider skills ([e02ff2d](https://github.com/alejandrom2/turnkey/commit/e02ff2d78be84f3d5287c70c29a908d1be82202a))
* Run Task key and Tasks dial for T3 Code's scheduled tasks ([5544af2](https://github.com/alejandrom2/turnkey/commit/5544af2258502e306b7fc3e5cc348b6729d383a7))
* Send Prompt sends your own text or one of Quick Prompt's templates ([45a45de](https://github.com/alejandrom2/turnkey/commit/45a45de9a3777ae2fc9bac3ef2776eb25669d399))
* Settle asks first, with a per-key Review, Hold or right-away setting ([ad9435f](https://github.com/alejandrom2/turnkey/commit/ad9435f1b8e28ce92fbbc30412eecf1b544183bf))
* skeleton faces while the deck first loads and connects ([ab51fb3](https://github.com/alejandrom2/turnkey/commit/ab51fb3be01b26682acf4143dac8af91dcef81ce))
* Snooze asks first like Settle and shows its duration, picked from presets ([5194dde](https://github.com/alejandrom2/turnkey/commit/5194dde854a73f2af9bba4bb8cdd5da0378e23ae))
* Stop stops the turn or, held, the workflows the thread runs ([b2ae282](https://github.com/alejandrom2/turnkey/commit/b2ae2821c469c30f912eeaa0c57290926f05c1d9))
* subagent counts on thread faces and a Stop Workflow key ([5b6e952](https://github.com/alejandrom2/turnkey/commit/5b6e952341c1ddb0caade432cc0e160a475c7ad5))
* T3 Code's status colors instead of orange: amber approvals, indigo questions ([d400fde](https://github.com/alejandrom2/turnkey/commit/d400fde8fb45c50a1ce335fdcff7a0bf1f60ff4a))
* T3 Deck, a Stream Deck plugin for T3 Code ([025dbe7](https://github.com/alejandrom2/turnkey/commit/025dbe7d55d1c5e43d5d2b60f92a6ceb860cfe56))
* talk to T3 Code through its client API, with Elgato-style keys ([0116d63](https://github.com/alejandrom2/turnkey/commit/0116d63fb8d19829ea8d70615d3069234b7e0b35))
* the actions list runs threads, sending, model, approvals, organize, git, tasks, open and dials, with older keys last and hidden ([c16148e](https://github.com/alejandrom2/turnkey/commit/c16148e3edb2c1c81d6bc1512238bacce1fdd1dc))
* the bundled profile gets a Usage page with Limits and Usage keys and dials ([e07b09a](https://github.com/alejandrom2/turnkey/commit/e07b09a4c6f458bca5121e8e194f53d2f2bb3a0c))
* the idle pet ships behind a feature flag, off for now ([462711f](https://github.com/alejandrom2/turnkey/commit/462711f8b28653cd468c4ecabac2111ac6ff73b0))
* the machine card speaks Stream Deck's own idiom, with Get a pair link ([3dd3a42](https://github.com/alejandrom2/turnkey/commit/3dd3a422a89f436fc1f2bfdadf55e32fa24598d0))
* the Model key's current pill takes the model's color, as the Power dial's does ([66fae3a](https://github.com/alejandrom2/turnkey/commit/66fae3a2364cef4ebc6d44588449280c7d332c89))
* the Model key's name takes the model's color by default, with a White option ([8081fac](https://github.com/alejandrom2/turnkey/commit/8081face54914c9599c0fe2558bce7a9dbe1b579))
* the model slider shows effort on its bottom row, beside Speed ([bcab5b8](https://github.com/alejandrom2/turnkey/commit/bcab5b8ecc2e44b5ffafd59d61d7143f59cd6dca))
* the model slider shows one pill per favorite instead of a filling track ([3052433](https://github.com/alejandrom2/turnkey/commit/3052433dc1705a02c257a1267763d40690fc7ba3))
* the model slider shows Speed along the bottom instead of Faster and Smarter ([191a565](https://github.com/alejandrom2/turnkey/commit/191a565f9c9b7653b79a9d896c68dd6f385c9eb5))
* the Organize key's Pin toggles, unpinning a pinned thread ([2ea32e1](https://github.com/alejandrom2/turnkey/commit/2ea32e12c71d17a1445552c8e5e96941b3621eff))
* the Power dial's model view can hide Speed and effort, and its pills sit lower when nothing is left below ([3ac8306](https://github.com/alejandrom2/turnkey/commit/3ac830627842e48d4eafac83368f1c09bb831d99))
* the Power dial's slider scrolls a long name and colors models like List and Carousel ([7ee89e7](https://github.com/alejandrom2/turnkey/commit/7ee89e728b8d47c60e5f48fe3cbe64dd9bcb08cc))
* the Power dial's slider shows the model's short name without its provider ([e744774](https://github.com/alejandrom2/turnkey/commit/e7447742e5480f55aaf8f4714a7ff0a6e3c57290))
* the Power slider leads with its provider, effort or mode icon, leaving the Speed bolt on the right ([43aa779](https://github.com/alejandrom2/turnkey/commit/43aa779f1a2e9b42c9dfb7851639e2699a13fdf6))
* the Power slider's fill takes the thread's model color ([ce45f25](https://github.com/alejandrom2/turnkey/commit/ce45f2527f46b6b9ce0caf41bbb675b747e0e742))
* the Power strip's accent follows the previewed model's color too ([c167045](https://github.com/alejandrom2/turnkey/commit/c167045620a8d443a27b1085f7aa7e4e7cdc7b7d))
* the Stream Deck + profile places every action ([e82fe2a](https://github.com/alejandrom2/turnkey/commit/e82fe2a4b324bbc117baaa7756effc34292ae750))
* the Threads dial's Classic strip is Elgato's thread rows, and Classic is its default ([601b00d](https://github.com/alejandrom2/turnkey/commit/601b00dcd1bb0bc06fa14999282c9e6598101e34))
* the Usage provider list comes from the machines ([87de77a](https://github.com/alejandrom2/turnkey/commit/87de77a13215e46b195df9f64690983ff52d80db))
* thread keys match Elgato's: gray and deep-shaded tiles, bare check, round chat, gray time, idle age ([9ca6db4](https://github.com/alejandrom2/turnkey/commit/9ca6db41c792387358bfc41a7e7d9e766f176e3c))
* translate the Power dial's Speed and Effort options and the Model key's Name color ([b7bb920](https://github.com/alejandrom2/turnkey/commit/b7bb920f7a2509d0e36c6700d7542212bc2012a9))
* Turnkey's own mark replaces T3 Code's logo ([fdf5667](https://github.com/alejandrom2/turnkey/commit/fdf5667bb14c9cf9f26d536b54a5ee36dff6e52c))
* Update T3, Run Script and Share Thread keys behind opt-in access ([ed4452a](https://github.com/alejandrom2/turnkey/commit/ed4452ad528ae916c0870dc1eb50c23b8b0b4a8f))
* Usage key and dial show a period's cost, tokens and model breakdown as T3 Code reports them ([3281776](https://github.com/alejandrom2/turnkey/commit/3281776c8b38ae938088a3a11e4a455bd32cffb9))
* Usage keys and dials can show one provider instead of all ([8aa855c](https://github.com/alejandrom2/turnkey/commit/8aa855c0fca4f7e27c5606f2044ab955696d748f))


### Fixes

* choosing a custom strip color in T3 Deck Settings saves the color it shows ([86f4571](https://github.com/alejandrom2/turnkey/commit/86f4571a73a0bde65c574924be13f9e92bd9d94f))
* collapse stray spaces in the Power slider's name and effort ([0ed7966](https://github.com/alejandrom2/turnkey/commit/0ed7966b59904303af2e4b8611fc6058227dc0aa))
* Devices dial says when it can't read devices instead of loading forever ([5b92db5](https://github.com/alejandrom2/turnkey/commit/5b92db583f099160740b338aea915672ab0093ed))
* Devices dial watches only the machine it shows, and starts over after a T3 Code restart ([d8a879a](https://github.com/alejandrom2/turnkey/commit/d8a879a48300422325b33b34e3a37c8d1796e992))
* Don't ask sticks, and opt-in keys read fresh config on press ([3301b66](https://github.com/alejandrom2/turnkey/commit/3301b66ed37cafcd730aba8cc9d4f7e6350d2cbb))
* Fork starts from the newest finished reply, as T3 Code's timeline offers it ([67d646c](https://github.com/alejandrom2/turnkey/commit/67d646cb0e37fcad2628513d03c23ac27ee935fd))
* Health uses T3 Code's provider status words ([e915c8b](https://github.com/alejandrom2/turnkey/commit/e915c8b8d96d2850ed708e016e0718e3fd517e00))
* Health's checklist ignores notes, and the thread picker starts unchosen ([d50d49a](https://github.com/alejandrom2/turnkey/commit/d50d49a0f78f9d816fa1c24a7f660dddd6652411))
* idle pet's passing step shows two legs ([660ff19](https://github.com/alejandrom2/turnkey/commit/660ff197233d7dc8ced80e010ae1848056f4205d))
* keys measure Chinese, Japanese and Korean text a full em per character, so it wraps and fits instead of overflowing ([d8f7746](https://github.com/alejandrom2/turnkey/commit/d8f774636aa9a23446d5cc5d7d86698e7f18c3c5))
* Merge Back leaves an archived parent to T3 Code ([30051b6](https://github.com/alejandrom2/turnkey/commit/30051b6edff3844b420c09ad94bb0483d928c88d))
* money and long model names fit the Usage and Limits faces ([453dc2c](https://github.com/alejandrom2/turnkey/commit/453dc2ca0496c6fa1f339b7001a596ea3b442525))
* narrow the Power dial's Speed toggle for the type checker ([74127d1](https://github.com/alejandrom2/turnkey/commit/74127d1e52974af0d59f516e89935672640fc9b6))
* provider problems and PR findings lists use templates, so translations can reorder them ([f7ada23](https://github.com/alejandrom2/turnkey/commit/f7ada23c2f897162d1853b825c7370d7b8967531))
* queues held by Stop, or left behind a removed message, still show ([94330fe](https://github.com/alejandrom2/turnkey/commit/94330fe397ca7ed0b0a8927cdf4c021fe9ecb51c))
* Run Task waits for its own machine instead of calling the task gone ([33f4d87](https://github.com/alejandrom2/turnkey/commit/33f4d87ac72a3e10ece44b39126a9e35e1c184cb))
* setting keys and the Power dial apply on the press ([b5c201c](https://github.com/alejandrom2/turnkey/commit/b5c201c865e4b2f2c27bb76767c4412c7642ec06))
* setting keys and the Power dial show the new value instead of a result card ([6fc0810](https://github.com/alejandrom2/turnkey/commit/6fc0810175d847ad1f9b3623cea7826b5926ea72))
* tapping the Power dial does nothing when the model has no Speed option ([b4aa891](https://github.com/alejandrom2/turnkey/commit/b4aa8912b16754fd2da2e02250a1550c680a6d3f))
* the category icon draws its prompt and spark dark, so they stand out ([8a633ad](https://github.com/alejandrom2/turnkey/commit/8a633ad2e5e3e18da5cff95d495ce658566a941d))
* the Model key's position pills share the key's width evenly, as Elgato's do ([35848d5](https://github.com/alejandrom2/turnkey/commit/35848d593c972321969676b55f3d4d1558fbd1ec))
* the Organize key shows its new state instead of a result card ([c662998](https://github.com/alejandrom2/turnkey/commit/c6629986d1a92c691b2f8ed594daee142191433c))
* the plain strip background is called Dark, and the hint says what it looks like ([10d8258](https://github.com/alejandrom2/turnkey/commit/10d8258d62175889f34a088ff260fb8227ff20af))
* the plugin no longer crashes when the inspector's settings request times out ([b7d2dd6](https://github.com/alejandrom2/turnkey/commit/b7d2dd66ff69ba2c60b756c304065d2210fcac81))
* the Power slider's name and effort are one text run, so the space between them shows ([7911a81](https://github.com/alejandrom2/turnkey/commit/7911a8101c944c6a32c4cd37f0224a20bd0f3832))
* the Usage page's last key is Health instead of a 90-day Usage key ([52efa57](https://github.com/alejandrom2/turnkey/commit/52efa579b44837b08037c87840e2718de87d55e2))
* truthful git faces, refused Fix Findings without findings, PR targeting ([3928ee5](https://github.com/alejandrom2/turnkey/commit/3928ee5042c5107847d141baead60b47b2f927b8))
* Turnkey's mark is flat SVG, so Stream Deck draws it ([4842270](https://github.com/alejandrom2/turnkey/commit/4842270ba2af4b22f6fdb2a000f2e73b0c2b44ec))
* Usage says which side to update on a contract mismatch, and long-press prices land in a fresh read ([5f74274](https://github.com/alejandrom2/turnkey/commit/5f74274ded0a30b205dce5b49bfcc06efa6fa56f))


### Reverts

* Power dial tiles go back to icons only; the name stays below them ([264979a](https://github.com/alejandrom2/turnkey/commit/264979a83e11301435e5224e5bb686d8702f6214))


### Chores

* release 0.10.0 ([bb0a0d1](https://github.com/alejandrom2/turnkey/commit/bb0a0d1b5e338f6d06b7c58f771ef270ddd0ac29))
* release 0.9.1 ([021589b](https://github.com/alejandrom2/turnkey/commit/021589b8480e79a586801f1dfc72e116c6c10f7b))

## [0.9.1](https://github.com/alejandrom2/turnkey/compare/v0.9.0...v0.9.1) (2026-10-27)


### Maintenance

* Releases now come from a tag: merging a release PR tags the version, and every `v*` tag publishes the GitHub Release with the packed plugin.

## 0.9.0 (2026-10-27)

First private beta of Turnkey for T3 Code.

### Features

* Threads on keys and dials: status, elapsed time, diffs, queued messages and subagents, with Elgato-style faces, motion and strip styles (Classic, List, Carousel).
* Send, steer, stop, quick prompts, skills, fork and merge back, new threads (in a worktree too), with confirm before sending.
* Model, effort (with Ultrathink), speed, access and plan controls across every favorite model and provider, with model-colored gradients.
* Approvals and questions answered from keys and the Answer dial, as far as each action's approval setting allows.
* Git (commit, push, create PR, pull), pull request actions (fix findings, explain, ask, review guide) and Open in editor or preview.
* Usage and Limits keys and dials, with T3 Code's own figures.
* Scheduled tasks, the queue, devices, health and diagnostics.
* Opt-in extra access per machine: Update T3, Run Script and Share Thread.
* Bundled profiles for Stream Deck +, Neo, 15-key, XL and Mini; the Neo info bar.
* Eight languages: English, German, Spanish, French, Japanese, Korean, and Simplified and Traditional Chinese.
* A settings window for machines, appearance, behavior and diagnostics.

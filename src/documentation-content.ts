export type DocSection = {
  id: string;
  title: string;
  text?: string[];
  steps?: string[];
  image?: string;
  illustration?: boolean;
  imageWidth?: number;
  imageHeight?: number;
  caption?: string;
  note?: string;
  table?: { headers: string[]; rows: string[][] };
  code?: string;
};
export type DocChapter = {
  id: string;
  group: string;
  title: string;
  summary: string;
  sections: DocSection[];
};
export const chapters: DocChapter[] = [
  {
    id: 'start',
    group: 'Getting started',
    title: 'Your first project',
    summary: 'Create an emote without learning 3D animation software.',
    sections: [
      {
        id: 'workspace',
        title: 'Start in Projects',
        text: [
          'The studio opens in Projects. Each project belongs to one workflow: Text to emote or Video to emote. Start a separate project to use the other workflow.',
        ],
        steps: [
          'Open the local Studio address shown in the terminal.',
          'Select New project. Give it a name and choose your workflow.',
          'Select Create project. A new project starts in a T pose with an empty timeline.',
          'Enter a public wallet address to preview a Decentraland avatar, or choose Use default avatar instead. Wallet import only changes the preview.',
        ],
        image: 'create-project.png',
        caption: 'The actual New project dialog: name your project and choose a workflow.',
        imageWidth: 1440,
        imageHeight: 1000,
      },
      {
        id: 'avatar-first-look',
        title: 'See your avatar from the start',
        text: [
          'Your wallet is only used to preview the avatar and its equipped wearables in the studio. You can continue with the default avatar and change your choice in Settings at any time.',
        ],
        image: 'avatar-onboarding.png',
        caption:
          'Choose a wallet preview or continue with the default avatar when you first open the editor.',
        imageWidth: 1440,
        imageHeight: 1000,
      },
      {
        id: 'save',
        title: 'Save and return later',
        text: [
          'Use Save in the upper-right area to save your changes. Open projects also autosave every five minutes. The back arrow beside the logo returns to Projects and asks how to handle changes before leaving.',
          'Projects supports renaming, deleting, list or preview views, and filtering by workflow. The current workspace uses a browser session; it is not a verified account that follows you across devices. Keep the installation data and browser session when continuing your work.',
        ],
      },
    ],
  },
  {
    id: 'text',
    group: 'Create an emote',
    title: 'Text to emote',
    summary: 'Describe one movement and preview the result on your avatar.',
    sections: [
      {
        id: 'describe',
        title: 'Write a clear prompt',
        steps: [
          'In Describe the emote, say what the person does. Name the body part and direction when they matter.',
          'Choose a Duration from 1s to 4s. Keep the action short enough to fit.',
          'Select Generate animation. Wait for the generation to finish.',
          'The result is added at the beginning of the timeline on a new Body layer. Play it, refine it, or remove it.',
        ],
        image: 'text-emote.png',
        caption: 'Text to emote after generation. No style category or template is applied.',
        note: 'Example: A person looks up, points at something in the sky with their right hand, then lowers their arm.',
        imageWidth: 1440,
        imageHeight: 1000,
      },
      {
        id: 'variation',
        title: 'Try another version',
        text: [
          'Each generation gets a new random seed by default. Keep style reuses the seed from your last generation so you can try a small wording change with the same random starting point. It becomes available after a generation.',
          'Reusing a seed does not guarantee identical motion after changing the prompt or duration. The Dance / Celebrate / Meme / Emotion / Rest presets are deferred to v2 and no longer influence generation, including when an older project stored a selection.',
        ],
      },
    ],
  },
  {
    id: 'loops',
    group: 'Create an emote',
    title: 'Loops with image poses',
    summary: 'Use one shared start/end pose and optional poses in between.',
    sections: [
      {
        id: 'references',
        title: 'Add your pose references',
        steps: [
          'Enable Loop animation in Text to emote.',
          'Add a clear, full-body photo to Start / End. This one pose is used at both ends.',
          'Review the detected pose. Drag body points to correct them, compare the front and side previews, then accept.',
          'Optionally add Middle and Middle 2, and set when each pose should happen with its timing slider.',
          'Describe the action between those poses and generate. Review the seam during repeated playback.',
        ],
        image: 'loop-slots-detail.png',
        caption:
          '1. Enable Loop animation. Start / End is one shared pose; the two middle slots are optional.',
        imageWidth: 249,
        imageHeight: 219,
      },
      {
        id: 'review-photo',
        title: 'Review the pose before generating',
        steps: [
          'After you select the Start / End photo, the review window opens.',
          'Drag a misplaced body point. Compare the front and side skeletons; adjust depth only when the pose looks wrong from the side.',
          'Select Accept pose when the body shape matches the photo. It will guide both the beginning and the end of your loop.',
        ],
        image: 'loop-review-detail.png',
        caption: '2. Review the photo and both skeleton views, then accept the pose.',
        imageWidth: 992,
        imageHeight: 804,
      },
      {
        id: 'accepted-photo',
        title: 'Build the movement between your poses',
        steps: [
          'The shared Start / End card now shows Accepted. You do not need to upload the same image twice.',
          'For a more specific movement, add Middle or Middle 2 and review each photo. Their timing sliders place them inside the animation.',
          'Write what happens between the poses, choose the duration and generate. For example: A person gently shifts their weight and returns to the starting pose.',
        ],
        image: 'loop-accepted-detail.png',
        caption: '3. An accepted reference is ready to guide both ends of the animation.',
        imageWidth: 249,
        imageHeight: 339,
      },
      {
        id: 'better-photos',
        title: 'Better pose photos: do and don’t',
        text: [
          'For Text to emote, use one clear full-body photo per pose. The same lighting, framing and clothing advice also improves video references in Fast and Pro.',
        ],
        image: 'pose-reference-dos-donts.png',
        illustration: true,
        caption:
          'AI-generated teaching examples. Left: cropped limbs and overlapping or hidden body parts. Right: the whole body is visible and the pose is easier to read.',
        steps: [
          'Keep the head, raised hands and both feet inside the photo, with some space around them.',
          'Use even lighting, a simple background and comfortable clothing with a visible body outline.',
          'Avoid hiding hands behind the body or crossing limbs so tightly that they are hard to distinguish. A front or slight three-quarter view often helps.',
          'Review the detected points and compare both pose previews before accepting. These photos guide body poses, not precise finger gestures.',
        ],
        imageWidth: 1254,
        imageHeight: 1254,
      },
      {
        id: 'loop-limits',
        title: 'Check the join',
        text: [
          'For a text-generated loop, Start / End uses the same accepted image at both ends. Middle and Middle 2 optionally guide what happens in between. Describe a repeatable action and allow time to return to the starting pose.',
          'Play several repetitions. If the join feels abrupt, set Timeline loop above 0 and adjust it a little at a time. Try 0.2s first. A long blend can soften or erase a quick gesture.',
          'Without image references, leave Loop animation off, generate normally, and make the loop in the timeline: trim a complete cycle, set Timeline loop, and inspect repeated playback.',
          'Choose In place for an emote in one spot. Keep Source when travel matters, but check that the ending location and direction fit the start. Sharing a pose does not automatically match the speed at the join.',
        ],
        image: 'timeline-loop-detail.png',
        caption:
          '4. Timeline loop at 0.3s blends the ending into the beginning. Check the join over several repetitions.',
        imageWidth: 872,
        imageHeight: 340,
      },
      {
        id: 'loop-controls',
        title: 'Three different loop controls',
        table: {
          headers: ['Control', 'What it does'],
          rows: [
            [
              'Loop animation',
              'Text to emote: opens image references with a shared Start / End pose.',
            ],
            [
              'Timeline loop',
              'Both workflows: blends the end of the full timeline into its start. Zero disables it.',
            ],
            [
              'Loop playback',
              'Both workflows: repeats the preview for inspection. It does not change the exported animation.',
            ],
          ],
        },
      },
    ],
  },
  {
    id: 'video',
    group: 'Create an emote',
    title: 'Video to emote',
    summary: 'Choose a clip, review its movement, then create the animation.',
    sections: [
      {
        id: 'prepare',
        title: 'Choose and trim a video',
        steps: [
          'Create a Video to emote project.',
          'Choose Fast for a quicker capture or Pro for more precise complex movement. Pro takes longer.',
          'Select video. The preparation window opens.',
          'Set the start and duration using the video strip and trim controls. Choose between 2 and 10 seconds.',
          'Select Analyze tracking. The progress bar and elapsed timer show what is happening.',
        ],
        image: 'video-prepare.png',
        caption:
          'Prepare your video before tracking: choose the segment you want to turn into an emote.',
        note: 'Use one visible person, a fixed camera, good lighting, and the whole body in frame. Visible hands and feet help. Camera movement and hidden limbs make the result less reliable.',
        imageWidth: 1440,
        imageHeight: 1000,
      },
      {
        id: 'better-video',
        title: 'Better video references: do and don’t',
        text: [
          'These recommendations apply to both Fast and Pro. Pro cannot reliably recover a person who leaves the frame for a long time or details hidden by blur and clothing.',
        ],
        image: 'video-reference-dos-donts.png',
        illustration: true,
        caption:
          'AI-generated teaching examples. Left: leaving the frame, strong blur or camera shake, and clothing that hides the body. Right: full-body framing, a steady sharp recording, and a clear silhouette.',
        table: {
          headers: ['Avoid', 'Try this instead'],
          rows: [
            [
              'Leaving the frame for several moments; cropped hands or feet.',
              'Step back and leave room around the person. Keep the full body visible throughout the action.',
            ],
            [
              'Heavy motion blur, shaking the camera, sudden zooms or pans.',
              'Rest the camera on a stable surface or tripod. Add even lighting and keep a fixed view. Fast movements are fine when they stay clear.',
            ],
            [
              'Bulky coats, loose layers, scarves or sleeves covering the hands.',
              'Wear comfortable clothing with a visible body outline. Keep hands uncovered; no special capture clothing is required.',
            ],
            [
              'Other people crossing or objects blocking the body.',
              'Record one person against a simple contrasting background. Keep the floor and feet visible.',
            ],
          ],
        },
        note: 'Pause the video at the beginning, middle and end. If you cannot clearly locate the hands, feet and body, choose a clearer segment or record it again.',
        imageWidth: 1024,
        imageHeight: 1536,
      },
      {
        id: 'review',
        title: 'Review and correct the tracking',
        steps: [
          'Use play, pause, the frame buttons, or the scrubber to inspect the movement. Slow playback to 0.5× for difficult moments.',
          'Compare the video with the separate tracking view. Toggle the overlay to see the video clearly.',
          'Scroll the mouse wheel over the video to zoom toward your cursor. Drag the background to pan; double-click to reset the view.',
          'Choose Body, Hands, or Body and hands. Pause, then drag a point in either view to correct it.',
          'Use Undo correction or Reset point if needed. Apply to nearby frames can spread the last correction backward or forward over a short interval.',
          'Use Review next issue to inspect uncertain frames. Once satisfied, select Accept and generate.',
        ],
        image: 'video-review.png',
        caption:
          'A real Fast capture in the review window. The video and tracking view show the same moment.',
        imageWidth: 1440,
        imageHeight: 1000,
      },
      {
        id: 'result',
        title: 'Refine the generated emote',
        text: [
          'After generation, the dialog closes and the result appears in separate Body and Hands layers. The left panel keeps Movement smoothness and Hand smoothness controls. Adjust them gradually; too much smoothing can soften quick gestures.',
          'Capture, Generation, and Processing time report how long the video took. These timings are stored with the result.',
          'Source is selected by default and Correct foot contacts starts off. In two-camera view, the second view can show the reference video for the selected video clip alongside the animated avatar.',
        ],
      },
      {
        id: 'video-loop',
        title: 'Make a loop from a video',
        steps: [
          'Record a complete cycle of a repeatable action, with the person visible from start to finish.',
          'In Prepare your video, trim to a section that starts and ends in a similar pose, facing a similar direction and moving at a similar pace.',
          'Analyze and review the tracking, then Accept and generate. Check the Body and Hands layers together.',
          'Choose In place if the avatar should stay in one spot. Use Source if traveling is part of the action, and check that the end location joins the start.',
          'In the timeline, set Timeline loop above 0 to blend the ending into the beginning. Try 0.2s first, then adjust while watching.',
          'Enable loop playback and watch several repetitions. Trim the clip or adjust Timeline loop if the join snaps, slides or looks rushed. Export when the cycle looks right.',
        ],
        note: 'Video to emote does not use the image-reference Loop animation checkbox. Generate the video animation first, then finish its loop in the timeline. Timeline loop affects the full timeline, so review all visible layers.',
        image: 'timeline-loop-detail.png',
        caption:
          'After video generation, use the same Timeline loop control. Here 0.3s is an example, not a required value.',
        imageWidth: 872,
        imageHeight: 340,
      },
      {
        id: 'video-source',
        title: 'Source or In place?',
        table: {
          headers: ['Mode', 'What it does', 'When to use it'],
          rows: [
            [
              'Source',
              'Keeps captured travel across the floor, turns and jumps.',
              'To compare with the original video or preserve intentional traveling steps.',
            ],
            [
              'In place',
              'Keeps the avatar near one spot on the floor while preserving turns, body movement and jumps.',
              'For an emote that should stay in one place or a loop that would otherwise drift.',
            ],
          ],
        },
        text: [
          'Example: someone steps sideways, turns and jumps. Source keeps the sideways travel. In place removes that travel but keeps the turn and jump.',
          'In place does not freeze the hips or force the avatar to face forward. It also does not close a loop automatically: the start and end must still join well. Both modes work for video-generated and text-generated animations.',
        ],
      },
    ],
  },
  {
    id: 'timeline',
    group: 'Edit and export',
    title: 'Edit the timeline',
    summary: 'Arrange movements, layer hands, and finish your loop.',
    sections: [
      {
        id: 'clips',
        title: 'Move and trim clips',
        steps: [
          'Select a clip to show its settings in the bottom bar.',
          'Drag the clip to change its start time. Drag its left or right edge to trim it.',
          'Use the duplicate, split, or remove icons. Hover over an icon to see its label. Split cuts at the playhead.',
          'Use play/pause, go to start/end, and loop playback to review. Zoom changes the timeline scale.',
        ],
        image: 'timeline-split-detail.png',
        caption:
          'Split cuts the selected clip at the playhead. Drag the center to move a clip, or either edge to trim it.',
        note: 'The timeline cannot extend past 10 seconds. It initially fits the generated animation; dragging, repeating, or slowing a clip must stay inside that limit.',
        imageWidth: 872,
        imageHeight: 340,
      },
      {
        id: 'finish-loop',
        title: 'Finish a loop in the timeline',
        steps: [
          'Select a complete movement cycle. Trim the clip by dragging its edges; keep a similar body pose and facing direction at the start and end.',
          'Set Timeline loop in the lower-right bar above zero. Start with 0.2s or 0.3s, then listen to the rhythm of the movement as you watch.',
          'Enable loop playback in the upper bar and watch the join several times. Lower the blend if it erases a quick gesture.',
          'Timeline loop affects the final animation. Loop playback only repeats the preview. Setting Timeline loop back to zero disables the blend.',
        ],
        image: 'timeline-loop-detail.png',
        caption:
          'The playback controls are above the clips; Timeline loop is in the lower-right settings bar.',
        imageWidth: 872,
        imageHeight: 340,
      },
      {
        id: 'layers',
        title: 'Body and Hands layers',
        text: [
          'Body clips and Hands clips keep their own layer types. Use + Hands to choose a hand-pose template; it fills the current timeline duration. These hand poses remain available independently of the removed Text to emote style presets.',
          'Layers can be muted, soloed, locked, reordered, or removed. Remove layer deletes its clips too. Removing the last clip automatically removes the empty layer. Playback stops and resets when no clips remain.',
          'Hands layers replace lower hand animation; their influence and blends still let you ease them in and out. They do not replace body movement.',
        ],
      },
      {
        id: 'settings',
        title: 'Understand clip settings',
        table: {
          headers: ['Control', 'What it does'],
          rows: [
            ['Speed / Repeat clip', 'Change playback speed or repeat the selected clip.'],
            [
              'Replace / Combine',
              'Choose how a Body clip contributes over lower layers. Hands uses Replace.',
            ],
            ['Influence', 'Reduce or increase the selected clip’s contribution.'],
            ['Blend in / Blend out', 'Ease into and out of an overlapping clip.'],
            [
              'Style: Smooth / Linear',
              'Shape the blend transition. This is not a generation style preset.',
            ],
            [
              'Timeline loop',
              'Blend the end of the full timeline into its beginning. Zero disables it.',
            ],
          ],
        },
        text: [
          'Loop playback repeats the preview; Timeline loop changes the resulting animation. Use both to inspect the join.',
        ],
      },
    ],
  },
  {
    id: 'avatar',
    group: 'Edit and export',
    title: 'Avatar and movement',
    summary: 'Preview your avatar and make simple position adjustments.',
    sections: [
      {
        id: 'viewport',
        title: 'Use the viewport',
        text: [
          'Drag to orbit and scroll to zoom. Switch between one and two cameras. Each camera has its own axis control; click an axis to align the view.',
          'The left viewport controls change camera count, skin/hair colors, Bones and Controls visibility, and Source / In place. Source preserves estimated travel. In place removes travel across the floor while preserving turns, body motion, and jumps.',
          'In place preserves turns and jumps while removing travel across the floor. It does not create a seamless loop on its own; inspect the join in the timeline.',
        ],
      },
      {
        id: 'adjust',
        title: 'Adjust a hand or foot',
        steps: [
          'Open Avatar controls on the right and choose a hand or foot.',
          'Use Left / right, Down / up, and Back / forward for small position changes.',
          'Open Angle for Tilt, Turn, and Roll. Body height and Elbow bend / Knee bend help refine the pose.',
          'Try Correct foot contacts when a supporting foot slides. Check jumps afterwards. Reset individual controls or use Reset all controls to return.',
        ],
        image: 'avatar-controls.png',
        caption: 'Plain-language position and angle controls for a selected body part.',
        imageWidth: 1440,
        imageHeight: 1000,
      },
      {
        id: 'wallet',
        title: 'Preview a custom avatar',
        text: [
          'Open Settings, then Custom avatar, and enter a public wallet address. The studio loads the avatar and wearables from that profile. No wallet connection or signature is required.',
          'This is a preview feature. Export emote exports the rig animation. Export GLB uses the default studio avatar, not the custom wearables. Missing or unusual wearables can affect the preview; reset to the default avatar to compare.',
        ],
      },
    ],
  },
  {
    id: 'export',
    group: 'Edit and export',
    title: 'Export',
    summary: 'Export the animated rig or the base avatar with its animation.',
    sections: [
      {
        id: 'formats',
        title: 'Export your animation',
        steps: [
          'Play the full timeline and inspect the feet, hands, and loop join.',
          'Select Export in the upper-right corner.',
          'Choose Export emote for the animated rig, or Export GLB for the default avatar with its animation.',
          'Open the exported file in the Decentraland Builder and verify how it plays before publishing.',
        ],
        image: 'export.png',
        caption: 'The two export choices serve different purposes.',
        imageWidth: 1440,
        imageHeight: 1000,
      },
      {
        id: 'names',
        title: 'Name the animation',
        text: [
          'The animation clip name inside the GLB matters, not only the file name. Use a capital first letter and underscores between words, such as Shadow_Boxing or Look_At_The_Sky. Avoid spaces and special characters.',
          'The studio bakes at 30 fps and limits the timeline to 10 seconds. Duration and number of samples are different: both endpoints can be present, so a 4-second clip may contain 121 samples. That does not mean it plays faster.',
        ],
      },
      {
        id: 'feedback',
        title: 'Report a problem',
        text: [
          'Report bugs and motion-quality issues through the GitHub repository: https://github.com/TonyDark0/dcl-motion-studio/issues.',
          'Include the workflow, operating system, hardware, reproduction steps and relevant error output. Remove tokens and private reference media before sharing. The local application does not submit generation ratings or collect a training dataset.',
        ],
      },
    ],
  },
  {
    id: 'technology',
    group: 'About the studio',
    title: 'Models and workflow',
    summary: 'The models behind the studio, explained in plain language.',
    sections: [
      {
        id: 'models',
        title: 'Models used',
        table: {
          headers: ['Model', 'What it helps with'],
          rows: [
            [
              'Kimodo + Llama-3-Kimodo',
              'Create body movement from your description and reviewed poses.',
            ],
            ['MediaPipe Pose', 'Find body poses in photos and video.'],
            ['RTMW3D', 'Follow body, hand and foot movement in Fast and Pro.'],
            ['SAM 3D Body', 'Give Pro additional detail for complex movement.'],
            ['MoGe-2', 'Help Pro understand the camera view.'],
            ['SOMAHand', 'Help shape captured hand poses for the avatar.'],
          ],
        },
      },
      {
        id: 'flow',
        title: 'From reference to emote',
        steps: [
          'Choose a text prompt or video. For an image-guided text loop, add pose photos.',
          'Review the reference poses or video tracking and correct visible mistakes.',
          'Generate the animation and preview it on the avatar.',
          'Adjust the timeline, check the loop if needed, and export.',
        ],
        text: [
          'Fast is quicker; Pro aims for more detail and takes longer. Both use the same review-and-edit workflow. Video preparation happens automatically.',
        ],
      },
      {
        id: 'limits',
        title: 'What to expect',
        text: [
          'Clear references help both modes. Models cannot reliably recreate movement that is out of frame, hidden or heavily blurred.',
          'Text generation creates body motion. Hand poses use a separate Hands layer; video capture adds hand movement on its own layer too. Facial animation is not included.',
          'Always review the result. More smoothing is not always more accurate, especially when the reference is unclear.',
        ],
      },
    ],
  },
  {
    id: 'next',
    group: 'About the studio',
    title: 'What’s next',
    summary: 'Help shape a simpler, more reliable emote creator.',
    sections: [
      {
        id: 'dataset',
        title: 'Evaluation and reference data',
        text: [
          'Improving generation requires evaluation against clear reference movements and repeatable tests. This local distribution does not automatically upload prompts, animations or references for evaluation or training.',
          'Any future shared evaluation dataset requires a separate contribution process and appropriate permissions for the material.',
        ],
      },
      {
        id: 'styles',
        title: 'Better creative starting points',
        text: [
          'Style templates are a possible future feature. They are not active generation presets in this release.',
        ],
      },
      {
        id: 'priorities',
        title: 'Where we want to improve',
        text: [
          'More stable feet, clearer turns and jumps, and more natural hand movement—especially in Fast.',
          'Better behavior when a reference is unclear, smoother loop joins, and easier ways to review and correct a capture.',
          'More predictable processing times, broader avatar compatibility, and clearer feedback when generation fails.',
        ],
      },
      {
        id: 'release',
        title: 'Source code and updates',
        text: [
          'The local application source is available at https://github.com/TonyDark0/dcl-motion-studio. The repository README documents installation, model downloads, native compilation and first use.',
          'Save your work and stop Studio before updating the source. Read the changes before replacing files or reinstalling dependencies; preserve the data directory and browser session used for your projects.',
        ],
      },
    ],
  },
  {
    id: 'setup',
    group: 'About the studio',
    title: 'Run locally',
    summary: 'Install the editor, native engine and models on your computer.',
    sections: [
      {
        id: 'start-local',
        title: 'Install the local distribution',
        text: [
          'This guide describes the local application. Generation and tracking run on your computer, and project data stays in this installation. The separately hosted beta has its own processing and access conditions.',
          'Follow the repository README for the complete Windows x64 setup: https://github.com/TonyDark0/dcl-motion-studio#local-installation. It includes Node.js 24, Git, CMake, Ninja and the LLVM-MinGW compiler.',
        ],
        steps: [
          'Install the build tools listed in the README and run npm ci in the Studio project folder.',
          'Run npm run setup:video, npm run setup:public and npm run setup:models. The combined generation/tracking weights require about 6.6 GB, plus runtime files.',
          'Compile the pinned Kimodo source with the Studio constraints patch. Keep the executable and required DLLs together in data/bin/kimodo-constraints/.',
          'Start npm run dev and open http://127.0.0.1:5173. In Settings → Kimodo → Configure, save the full executable/model paths and select CPU before checking and activating Studio Constraints.',
          'Create a text project, generate a short movement, preview it and export a GLB. This verifies model loading beyond the executable capability check.',
        ],
      },
      {
        id: 'models-local',
        title: 'Prepare inference separately',
        text: [
          'Run npm run setup:public to download the MediaPipe pose model, then npm run setup:models for the pinned Kimodo, text-encoder, tokenizer and RTMW3D files. The scripts verify downloads. Keep tokenizer.gguf beside the text encoder.',
          'Compile the native Kimodo executable with the Studio constraints patch. In Settings → Kimodo → Configure, enter its full path and the SOMA/text-model paths, select CPU and save. Then check the installation and activate Studio Constraints.',
          'SAM 3D Body weights require accepting their license and authorized model access. Follow the setup script output; never put an access token in client code or public files.',
        ],
        note: 'Text generation and Fast capture support CPU execution. Pro requires its separate Python/PyTorch environment and a compatible NVIDIA GPU. Memory usage and processing time depend on the hardware, models and input; this release does not certify a universal minimum RAM or VRAM.',
      },
      {
        id: 'storage',
        title: 'Storage and model licenses',
        text: [
          'The local data directory holds projects, jobs, prepared media, weights and configuration.',
          'The app being open source does not replace the separate licenses of models, weights, wearables, and source media. Check the licenses supplied with each component when redistributing or hosting.',
        ],
      },
    ],
  },
  {
    id: 'help',
    group: 'About the studio',
    title: 'Troubleshooting',
    summary: 'Diagnose local setup, tracking, generation and project-storage problems.',
    sections: [
      {
        id: 'tracking-errors',
        title: 'A capture fails or asks for review',
        text: [
          'Check that the person stays visible and choose a shorter segment with clear hands and feet. If a required pose is uncertain, inspect the first/last moments and use Review next issue. Correct visible points before accepting.',
          'Keep the terminal running Studio open and inspect its error output. Confirm that the local API is available, the engine/model paths are configured and the selected capture runtime is installed. Correct a tracking validation error before generating again; valid tracking cannot prevent every runtime or memory failure.',
        ],
      },
      {
        id: 'motion-issues',
        title: 'The motion slides, floats, or looks noisy',
        text: [
          'Compare the result with the reference in Source mode first. Review tracking confidence, especially around occlusion or a jump. Increase Movement smoothness or Hand smoothness gradually, and check that quick actions still read correctly.',
          'Use small avatar-control corrections where needed. In place removes horizontal travel while preserving turns and height; it cannot correct an incorrectly captured pose by itself.',
        ],
      },
      {
        id: 'project-issues',
        title: 'A project or export is missing',
        text: [
          'Return to the same local Studio address using the same browser profile. Clearing cookies, switching between localhost and 127.0.0.1, or changing browsers can disconnect the browser session from its existing workspace. Preserve the installation data directory; a GLB export is not a backup of the editable project.',
          'Export needs at least one timeline clip. Remove or shorten clips that exceed 10 seconds, and check the animation in the Builder after exporting. A custom wallet avatar is only used for preview.',
        ],
      },
      {
        id: 'browser',
        title: 'The page or preview does not load',
        steps: [
          'Keep npm run dev running and open http://127.0.0.1:5173, or use npm start after building and open http://127.0.0.1:8787. Stop the previous mode before switching.',
          'Use a browser with hardware acceleration and WebGL enabled. Close other heavy tabs if the preview is slow.',
          'Check the terminal for startup errors or ports already in use. An available API does not mean the native engine and model paths are configured.',
          'Save your work before refreshing. Do not clear cookies or site storage as a first troubleshooting step; the local workspace uses a browser session.',
        ],
        note: 'For installation diagnostics and model paths, use README.md and docs/TROUBLESHOOTING.md in the repository. Model downloads and optional wallet-avatar loading need Internet; local inference does not require a cloud account.',
      },
    ],
  },
];

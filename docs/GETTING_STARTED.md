# Your first animation

This guide assumes you have completed the [local installation](../README.md#local-installation): dependencies, model downloads and native engine. The base avatar is already included in the package. No knowledge of the internal models or retargeting math is needed for the steps below.

## Open Studio

1. Open a terminal in the project folder and run `npm run dev`.
2. Keep that terminal open and visit [http://127.0.0.1:5173](http://127.0.0.1:5173).
3. If the appearance setup or Studio tour appears, complete it or use its skip control. These configure the editor; they do not create an online account.
4. Open Settings → Kimodo → Configure. Fill the executable and two model paths, select CPU and choose **Save configuration**. Reopen Configure, use **Check installation**, then **Use Studio Constraints**. See the [configuration table](../README.md#6-start-the-local-editor) for which file belongs in each field.

**You should see:** the project workspace and a visible avatar when a project is open. If the page stays on “Opening your local workspace” or the avatar cannot load, use [troubleshooting](TROUBLESHOOTING.md).

## Generate an animation from text

1. Choose **New project**.
2. Enter a name, choose **Text to emote** in Workflow, then choose **Create project**.
3. Enter a simple action, for example: **A person waves with their right hand.**
4. Choose **Generate animation** in the text panel. Leave **Loop animation** off for this first attempt; image-pose guidance is not needed yet. Keep other settings at their defaults.
5. Wait for the result. CPU generation can take time; keep the local service running. If an error appears, read it before retrying.
6. Play the animation with the playback control or press Space when you are not typing in a field. Pause and inspect the movement from another camera angle.

**You should see:** movement on the avatar and an animation clip in the timeline. A finished generation is a starting point: check the feet, hands and overall action before exporting.

## Make a simple adjustment

Pause on a useful moment. Use the avatar controls to select a hand or foot and change its target position slightly. **IK** means that the arm or leg bends to reach the chosen target. Inspect the whole clip afterward, because a control can affect more than the paused pose.

For the first result, avoid combining several layers or changing many controls at once. Undo an unwanted edit before trying another. There is no individual-keyframe editor in this version.

## Save and export

1. Use **Save** to keep the editable project in the local application.
2. Open the **Export** menu.
3. Choose **Export emote** for the animation skeleton, or **Export GLB** for the default avatar with its animation.
4. Save the downloaded file using your browser's download controls and test it in the intended destination.

**Save and export are different.** Saving retains editable clips, layers and controls. A GLB is a baked 3D animation file; it is not a backup of the whole Studio project. A wallet-avatar preview is not included in the exported GLB.

Changing the project later does not update an existing downloaded file. Export again to include new edits. Export emote applies duration/size checks; passing them does not guarantee approval by Decentraland's publication tools.

## Try video after text works

1. Create a project with Workflow set to **Video to emote**, then choose **Fast** as the capture engine.
2. Select a video containing one person, with a fixed camera and the full body visible. Start with a short, clear movement.
3. Select a 2–10 second segment, then choose **Analyze tracking**.
4. Wait for the review dialog. Play through it and check whether points follow the correct body parts. Tracking points describe the reference; this is not the final generated animation yet.
5. Correct visible points where useful. If important limbs remain missing or the tracking is poor throughout, choose a clearer segment instead of forcing acceptance.
6. Choose **Accept and generate**. The application validates the reviewed tracking before starting body generation.
7. Review the result on the avatar. Body and Hands appear as separate layers. You can adjust their smoothing without generating again.
8. Save the project and export when the result is useful.

If generation fails, the reviewed tracking remains available for retry. Correct a reported tracking problem before resubmitting. Fast runs on CPU; Pro needs its separate GPU setup.

## What to try next

- [Image poses](image-pose-references.md): guide a loop with accepted reference poses.
- [Video review](video-review-workspace.md): point editing and comparison controls.
- [Timeline](nla-editor.md): trimming, repetitions, layers and seamless ranges.
- [Wallet avatar](custom-avatar.md): preview a public Decentraland appearance.
- [Troubleshooting](TROUBLESHOOTING.md): when a step fails.

The [online guide](https://dclmotionstudio.xyz/docs) and separate [hosted beta](https://dclmotionstudio.xyz/app) can help you explore. Their availability and features can differ from this local release.

## A few terms used in the editor

| Term                        | Meaning here                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Model / weights             | Downloaded data used by the animation or tracking program. Installing the web interface does not install these files. |
| Native engine               | The separate local Kimodo program that generates body motion.                                                         |
| Rig / skeleton              | The character's bones and hierarchy. This release expects the DCL rig.                                                |
| Tracking points / landmarks | Estimated body/hand positions from your reference, reviewed before generation.                                        |
| IK                          | Moving a hand/foot target and letting the arm/leg bend to reach it.                                                   |
| Clip / layer                | A timed piece of animation / a separate contribution combined with other movement.                                    |
| Root movement               | Movement of the character across the scene; In place removes horizontal travel.                                       |
| Bake / GLB                  | Store the evaluated movement in a playable 3D file instead of keeping live editor controls.                           |

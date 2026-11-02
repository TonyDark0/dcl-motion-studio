# Preparing a video for local tracking

Video preparation trims the chosen segment and produces a consistent input for tracking. It is a local preprocessing operation, independent of Kimodo generation. This filename is retained for existing documentation links; SDPose is not part of the active preparation pipeline.

## Request and output

The browser sends the selected video to the loopback API at `/api/media/prepare`, with start, duration and Fast/Pro mode. Node streams the input to temporary storage and invokes FFmpeg. The prepared clip is H.264, yuv420p, silent and normalized to 30 fps.

| Profile | Maximum long edge | CRF |
| ------- | ----------------: | --: |
| Fast    |        960 pixels |  21 |
| Pro     |       1440 pixels |  18 |

Smaller inputs are not enlarged. Frame-rate normalization can repeat/drop decoded frames; it does not synthesize unseen body poses. Compression and downscaling can remove detail, especially when fingers occupy few pixels.

## Reference and tracking views

The browser retains the reference for review. Tracking operates on the prepared segment; crop and point coordinates are mapped to the displayed video's geometry. The reviewed segment can be stored locally with a completed generation for synchronized comparison after a project reload. It is not uploaded to a hosted service by this distribution.

## Resource management

The preparation service limits input size, duration, resolution and concurrent conversions. It streams data rather than storing a large base64 JSON request. One conversion can run at a time; another request receives a busy response. Cancellation terminates the conversion and releases temporary files.

Temporary original/prepared files and the intentionally retained comparison reference have different lifecycles. Do not assume that deleting a temporary conversion deletes the saved project reference.

The working limits and encoding arguments are defined in [video-media.ts](../server/video-media.ts); reference retention and range playback are in [video-results.ts](../server/video-results.ts). FFmpeg and FFprobe must both be available, including support for the selected H.264 encoder. See the [installation guide](../README.md#local-installation).

## Relation to Pro and proposed models

Pro uses the same preparation endpoint with its higher-resolution profile, then invokes the local SAM/MoGe runtime. See [Pro capture](pro-capture-pipeline.md). SDPose and a separate detector are research options only; neither is downloaded nor executed by the current setup. See [proposal status](sdpose-selective-support.md).

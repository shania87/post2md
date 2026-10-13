# post2md

Share a social media post into this page and get LLM-ready markdown plus the post's images, then share that on into Claude or ChatGPT.

Live: https://shania87.github.io/post2md/ (once Pages is enabled)

## Sites

- **X**: the post, the author's own thread, the parent chain it replies to (up to 5), quoted posts, and images. Data comes from `api.fxtwitter.com`. Replies from other accounts aren't included.
- **Reddit**: handed off to [RedditMD](https://adoucett.github.io/RedditMD/). Short `/s/` share links have to be opened in a browser first.

To add a site, add a matcher to `resolve.js` and an entry to `sites.js` (`load` + `format`, or `handoff`).

## Use on Android

1. Open the live page in Chrome and choose **Add to Home screen** / **Install app**.
2. In the X app, press Share on a post and pick **post2md**.
3. Untick any images you don't want, then press **Share** and pick the Claude or ChatGPT app. **Copy** is the fallback.

You can also paste a link, or open `?u=<link>`.

## Develop

No build step. Serve the folder (`python -m http.server`) and open it. Tests: `npm test` (Node 20+).

# post2md

Share a social media post into this page and get LLM-ready markdown plus the post's images, then share that on into Claude or ChatGPT.

Live: https://shania87.github.io/post2md/

## Sites

- **X**: the post, the author's own thread, the parent chain it replies to (up to 5), quoted posts, images, and the top replies from other accounts (first page, about 30–60, ranked by likes, nested by who answered whom). Data comes from `api.fxtwitter.com`. Untick **Include replies** to leave them out.
- **Threads**: the post, the author's own thread (whichever part you share), the posts it replies to, quoted posts, images (carousels too; videos are linked), and the first page of replies Threads loads, in its order. threads.com can't be read from another site, so pages come through a small Cloudflare Worker relay in `worker/` (`npx wrangler deploy` from that folder). Some networks block `*.workers.dev`; mobile data works. Threads image links expire after a few days.
- **Reddit**: the post (title, text, flair), its image, gallery or link (videos are linked), the original of a crosspost, and up to 100 comments, nested, highest score first at each level. Reddit blocks reads from other sites, so data comes from the [Arctic Shift](https://arctic-shift.photon-reddit.com) archive: scores are as archived, and very new posts can take up to a day to appear. Share links (`/r/<sub>/s/<code>`) are resolved by the same Worker relay.

To add a site, add a matcher to `resolve.js` and an entry to `sites.js` (`load` + `format`, or `handoff`).

## Use on Android

1. Open the live page in Chrome and choose **Add to Home screen** / **Install app**.
2. In the X, Threads or Reddit app, press Share on a post and pick **post2md**.
3. Untick any images you don't want, then press **Share** and pick the Claude or ChatGPT app. **Copy** is the fallback.

You can also paste a link, or open `?u=<link>`.

## Develop

No build step. Serve the folder (`python -m http.server`) and open it. Tests: `npm test` (Node 20+).

## License

MIT, see [LICENSE](LICENSE). The sample posts in `test/fixtures/` are fxtwitter API responses for public X posts and trimmed page data for public Threads posts, and trimmed Arctic Shift responses for public Reddit posts. They're included only as test data, and the license doesn't cover them.

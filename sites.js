// One entry per supported site. load() fetches, format() returns { title, markdown, images }.
// A site with handoff() instead sends the user to another tool.

import { loadX } from "./x.js";
import { formatX } from "./format-x.js";
import { loadThreads } from "./threads.js";
import { formatThreads } from "./format-threads.js";

export const SITES = {
  x: {
    label: "X",
    load: (link) => loadX(link.id),
    format: formatX,
  },
  threads: {
    label: "Threads",
    load: (link) => loadThreads(link),
    format: formatThreads,
  },
  reddit: {
    label: "Reddit",
    // Parked on RedditMD (see the product brief). Its page reads ?url= and starts the export.
    // Short /s/ share links still need opening in a browser first: RedditMD can't resolve them.
    handoff: (link) => ({
      href: `https://adoucett.github.io/RedditMD/?url=${encodeURIComponent(link.url)}`,
      label: "Open in RedditMD",
      note: link.url.includes("/s/")
        ? "This is a Reddit share link. RedditMD needs the full post link: open it in the browser first, then share that."
        : "Reddit isn't handled here yet. RedditMD does it well.",
    }),
  },
};

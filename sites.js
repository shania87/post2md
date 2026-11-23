// One entry per supported site. load() fetches, format() returns { title, markdown, images }.
// A site with handoff() instead sends the user to another tool.

import { loadX } from "./x.js";
import { formatX } from "./format-x.js";
import { loadThreads } from "./threads.js";
import { formatThreads } from "./format-threads.js";
import { loadReddit } from "./reddit.js";
import { formatReddit } from "./format-reddit.js";

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
    load: (link) => loadReddit(link),
    format: formatReddit,
  },
};

// Getting markdown and images out of the page and into the LLM app.

const MAX_FILES = 4;

// Images are fetched as soon as the preview renders. navigator.share() needs a recent tap,
// and waiting for downloads after the tap can use that up.
export async function prefetch(images, fetchImpl = fetch) {
  await Promise.all(images.map(async (img, i) => {
    try {
      const res = await fetchImpl(img.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const ext = (blob.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
      img.file = new File([blob], `post2md-${img.tweetId}-${i + 1}.${ext}`, { type: blob.type });
    } catch (err) {
      img.error = String(err.message || err);
    }
  }));
}

export async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

// Returns what actually happened, so the page can say so.
export async function shareOut({ title, markdown, images }) {
  const files = images.filter((img) => img.checked && img.file).slice(0, MAX_FILES).map((img) => img.file);
  if (files.length && navigator.canShare?.({ text: markdown, files })) {
    await navigator.share({ title, text: markdown, files });
    return `Shared text and ${files.length} image${files.length > 1 ? "s" : ""}.`;
  }
  if (navigator.share) {
    await navigator.share({ title, text: markdown });
    return files.length ? "This device can't share files, so only the text went." : "Shared text.";
  }
  await copyText(markdown);
  return "Sharing isn't available here. Markdown copied instead.";
}

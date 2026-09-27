/** Landing page behaviour: reveal on scroll, and a note for visitors with a saved project. */

const items = document.querySelectorAll<HTMLElement>(".reveal");
if ("IntersectionObserver" in window && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("in");
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  for (const el of items) {
    el.classList.add("pending");
    observer.observe(el);
  }
}

/** The CAD used to live at "/". People with an auto-saved project are told where it went. */
async function hasSavedProject(): Promise<boolean> {
  try {
    if (!("databases" in indexedDB)) return false;
    const list = await indexedDB.databases();
    if (!list.some((d) => d.name === "fabcad")) return false;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("fabcad");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("open failed"));
    });
    if (!db.objectStoreNames.contains("projects")) {
      db.close();
      return false;
    }
    const value = await new Promise<unknown>((resolve, reject) => {
      const request = db.transaction("projects", "readonly").objectStore("projects").get("autosave");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("read failed"));
    });
    db.close();
    if (typeof value !== "string") return false;
    const file = JSON.parse(value) as { document?: { timeline?: unknown[] } };
    return (file.document?.timeline?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

void hasSavedProject().then((saved) => {
  const banner = document.getElementById("welcome-back");
  if (saved && banner) banner.hidden = false;
});

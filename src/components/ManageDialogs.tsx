import { useEffect, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { errorMessage, imageUrl, type Metadata } from "@/lib/api";
import { manage, type Artwork, type ManageDialog, type MatchResult } from "@/lib/manage";
import { useNav } from "@/lib/nav";
import { cn } from "@/lib/utils";

const inputClass =
  "bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-lg border px-3 text-sm outline-none focus-visible:ring-[3px]";

/** The admin dialog picked from an item's menu. */
export function ManageDialogs({
  item,
  dialog,
  onClose,
  leaveOnDelete,
}: {
  item: Metadata;
  dialog: ManageDialog | null;
  onClose: () => void;
  /** Go back a page after deleting, when the page was the deleted item's own. */
  leaveOnDelete?: boolean;
}) {
  if (!dialog) return null;
  const props = { item, onClose };
  switch (dialog) {
    case "match":
      return <FixMatch {...props} />;
    case "edit":
      return <EditDetails {...props} />;
    case "poster":
      return <ChoosePoster {...props} />;
    case "delete":
      return <ConfirmDelete {...props} leave={leaveOnDelete} />;
  }
}

function Shell({
  title,
  description,
  onClose,
  children,
  wide,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={cn("gap-4 p-6", wide && "w-[min(52rem,calc(100vw-2rem))]")}>
        <div>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function FixMatch({ item, onClose }: { item: Metadata; onClose: () => void }) {
  const { server } = useNav();
  const [title, setTitle] = useState(item.title);
  const [year, setYear] = useState(item.year ? String(item.year) : "");
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    setSearching(true);
    setError(null);
    try {
      setResults(await manage.findMatches(item.ratingKey, title.trim(), Number(year) || null));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSearching(false);
    }
  };
  useEffect(() => {
    search();
    // Search once with the current title on open; later searches are by hand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = async (r: MatchResult) => {
    setApplying(r.guid);
    setError(null);
    try {
      await manage.applyMatch(item.ratingKey, r);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setApplying(null);
    }
  };

  return (
    <Shell title="Fix match" description="Pick the right title if Plex matched this to the wrong one." onClose={onClose}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} aria-label="Title" />
        <input
          value={year}
          onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
          placeholder="Year"
          className={cn(inputClass, "w-24")}
          aria-label="Year"
        />
        <Button type="submit" variant="outline" disabled={searching}>
          {searching ? <Loader2 className="animate-spin" /> : <Search />} Search
        </Button>
      </form>
      {error && <p className="text-destructive text-sm break-words">{error}</p>}
      <div className="-mx-2 max-h-[50vh] min-h-32 overflow-y-auto">
        {results?.length === 0 && <p className="text-muted-foreground p-6 text-center text-sm">No matches found.</p>}
        {results?.map((r) => (
          <button
            key={r.guid}
            disabled={applying !== null}
            onClick={() => apply(r)}
            className="hover:bg-accent/50 flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left"
          >
            <div className="bg-muted aspect-[2/3] w-12 shrink-0 overflow-hidden rounded">
              {r.thumb && <img src={imageUrl(server, r.thumb, 48, 72)} alt="" className="size-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">
                {r.name} {r.year && <span className="text-muted-foreground font-normal">({r.year})</span>}
              </div>
              {r.summary && <p className="text-muted-foreground line-clamp-2 text-xs">{r.summary}</p>}
            </div>
            {applying === r.guid ? (
              <Loader2 className="size-4 shrink-0 animate-spin" />
            ) : (
              r.score != null && <span className="text-muted-foreground shrink-0 text-xs">{r.score}%</span>
            )}
          </button>
        ))}
      </div>
    </Shell>
  );
}

/** Fields that can be changed, by Plex's name for them. */
const FIELDS: { key: string; label: string; get: (m: Metadata) => string; multiline?: boolean; types?: string[] }[] = [
  { key: "title", label: "Title", get: (m) => m.title },
  { key: "titleSort", label: "Sort title", get: (m) => m.titleSort ?? "", types: ["movie", "show"] },
  { key: "originalTitle", label: "Original title", get: (m) => m.originalTitle ?? "", types: ["movie", "show"] },
  { key: "year", label: "Year", get: (m) => (m.year ? String(m.year) : ""), types: ["movie", "show"] },
  { key: "summary", label: "Summary", get: (m) => m.summary ?? "", multiline: true },
];

function EditDetails({ item, onClose }: { item: Metadata; onClose: () => void }) {
  const fields = FIELDS.filter((f) => !f.types || f.types.includes(item.type));
  const [values, setValues] = useState(() => Object.fromEntries(fields.map((f) => [f.key, f.get(item)])));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const changed = fields.filter((f) => values[f.key] !== f.get(item)).map((f) => [f.key, values[f.key].trim()] as [string, string]);
    if (!changed.length) return onClose();
    if (item.librarySectionID == null) return setError("Plex didn't say which library this is in.");
    setSaving(true);
    setError(null);
    try {
      await manage.edit(item.librarySectionID, item.ratingKey, item.type, changed);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(false);
    }
  };

  return (
    <Shell title="Edit details" description="Changed fields are locked, so a metadata refresh keeps them." onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        {fields.map((f) => (
          <label key={f.key} className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{f.label}</span>
            {f.multiline ? (
              <textarea
                value={values[f.key]}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                rows={5}
                className={cn(inputClass, "h-auto py-2")}
              />
            ) : (
              <input
                value={values[f.key]}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                className={inputClass}
              />
            )}
          </label>
        ))}
        {error && <p className="text-destructive text-sm break-words">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />} Save
          </Button>
        </div>
      </form>
    </Shell>
  );
}

function ChoosePoster({ item, onClose }: { item: Metadata; onClose: () => void }) {
  const { server } = useNav();
  const [posters, setPosters] = useState<Artwork[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    manage
      .posters(item.ratingKey)
      .then(setPosters)
      .catch((e) => setError(errorMessage(e)));
  }, [item.ratingKey]);

  const pick = async (p: Artwork) => {
    setSaving(p.ratingKey);
    setError(null);
    try {
      await manage.setPoster(item.ratingKey, p.ratingKey);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
      setSaving(null);
    }
  };

  return (
    <Shell title="Change poster" onClose={onClose} wide>
      {error && <p className="text-destructive text-sm break-words">{error}</p>}
      <div className="grid max-h-[60vh] grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3 overflow-y-auto p-1">
        {posters === null && !error && (
          <div className="col-span-full grid h-40 place-items-center">
            <Loader2 className="text-muted-foreground size-6 animate-spin" />
          </div>
        )}
        {posters?.map((p) => (
          <button
            key={p.ratingKey}
            disabled={saving !== null}
            onClick={() => pick(p)}
            className={cn(
              "bg-muted relative aspect-[2/3] overflow-hidden rounded-lg border transition-all hover:scale-[1.03]",
              p.selected && "ring-primary ring-2",
            )}
            title={p.provider ?? undefined}
          >
            {(p.thumb ?? p.key) && (
              <img src={imageUrl(server, p.thumb ?? p.key, 128, 192)} alt="" loading="lazy" className="size-full object-cover" />
            )}
            {p.selected && (
              <span className="bg-primary text-primary-foreground absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full">
                <Check className="size-3" />
              </span>
            )}
            {saving === p.ratingKey && (
              <span className="absolute inset-0 grid place-items-center bg-black/50">
                <Loader2 className="size-6 animate-spin text-white" />
              </span>
            )}
          </button>
        ))}
      </div>
    </Shell>
  );
}

function ConfirmDelete({ item, onClose, leave }: { item: Metadata; onClose: () => void; leave?: boolean }) {
  const { back } = useNav();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const what = item.type === "show" ? "every episode of this show" : item.type === "season" ? "every episode of this season" : "this file";

  const confirm = async () => {
    setDeleting(true);
    setError(null);
    try {
      await manage.delete(item.ratingKey);
      onClose();
      if (leave) back();
    } catch (e) {
      setError(errorMessage(e));
      setDeleting(false);
    }
  };

  return (
    <Shell title={`Delete “${item.title}”?`} description={`This deletes ${what} from the server's disk. It can't be undone.`} onClose={onClose}>
      {error && <p className="text-destructive text-sm break-words">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="destructive" disabled={deleting} onClick={confirm}>
          {deleting && <Loader2 className="animate-spin" />} Delete
        </Button>
      </div>
    </Shell>
  );
}

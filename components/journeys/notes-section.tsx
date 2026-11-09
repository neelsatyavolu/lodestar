import { NotebookPen, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, post } from "@/lib/client";
import type { Note } from "@/lib/journeys/types";
import { inputClass } from "../dialog";
import { Button } from "../ui";
import { AiButton, AiStatus, EmptyState, type Generator } from "./ai-draft";
import { errorText } from "./shared";
import { askConfirm } from "../confirm";

// Titled notes in the Overview: "How the week works", "Dietary needs",
// "Getting around". Written by hand, by the AI or by an agent.

const textareaClass = "w-full resize-y rounded-md border border-hairline-hover bg-card px-3 py-2 text-[14px] leading-relaxed text-ink outline-none placeholder:text-mute focus:border-accent";

function NoteEditor({ note, onSave, onCancel }: { note?: Note; onSave: (title: string, body: string) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSave(title.trim(), body.trim());
    } catch (err) {
      setError(errorText(err, "Couldn't save the note."));
      setBusy(false);
    }
  };
  return (
    <form
      className="space-y-2 rounded-xl border border-hairline-strong bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) save();
      }}
    >
      <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title, like Dietary needs" aria-label="Note title" maxLength={120} className={inputClass} />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write anything the group should know" aria-label="Note" rows={4} maxLength={8000} className={textareaClass} />
      {error && <p className="text-[12px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="quiet" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" variant="primary" disabled={busy || !title.trim()}>
          Save note
        </Button>
      </div>
    </form>
  );
}

type Props = {
  journeyId: string;
  notes: Note[];
  gen: Generator;
  onNotes: (update: (n: Note[]) => Note[]) => void;
  /** The note being edited, "new" for one being written; held by the parent so its menu can start one. */
  editing: string | null;
  setEditing: (id: string | null) => void;
};

export function NotesSection({ journeyId, notes, gen, onNotes, editing, setEditing }: Props) {
  const [error, setError] = useState<string | null>(null);

  const create = async (title: string, body: string) => {
    const { note } = await post<{ note: Note }>(`/api/journeys/${journeyId}/notes`, { title, body });
    // A note with the same title was replaced, so drop the old copy.
    onNotes((ns) => [...ns.filter((n) => n.id !== note.id), note]);
    setEditing(null);
  };
  const update = async (id: string, title: string, body: string) => {
    const { note } = await api<{ note: Note }>(`/api/journeys/notes/${id}`, { method: "PATCH", body: JSON.stringify({ title, body }) });
    onNotes((ns) => ns.map((n) => (n.id === id ? note : n)));
    setEditing(null);
  };
  const remove = async (n: Note) => {
    if (!(await askConfirm(`Delete the note “${n.title}”?`, "Delete note"))) return;
    try {
      await api(`/api/journeys/notes/${n.id}`, { method: "DELETE" });
      onNotes((ns) => ns.filter((x) => x.id !== n.id));
    } catch (err) {
      setError(errorText(err, "Couldn't delete the note."));
    }
  };

  return (
    <div className="space-y-3">
      <AiStatus gen={gen} parts={["notes"]} />
      {error && <p className="text-[13px] text-danger">{error}</p>}
      {notes.length === 0 && editing !== "new" && (
        <EmptyState icon={<NotebookPen size={18} />} title="No notes yet" body="How the days work, dietary needs, getting around. Anything everyone going should know.">
          <AiButton gen={gen} part="notes" variant="primary" />
          <Button size="sm" variant="ghost" onClick={() => setEditing("new")}>
            <Plus size={14} /> Write one
          </Button>
        </EmptyState>
      )}
      {notes.map((n) =>
        editing === n.id ? (
          <NoteEditor key={n.id} note={n} onSave={(t, b) => update(n.id, t, b)} onCancel={() => setEditing(null)} />
        ) : (
          <article key={n.id} className="group rounded-xl border border-hairline-strong bg-card px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <h4 className="text-[15px] font-medium text-ink">{n.title}</h4>
              <div className="-mr-2 -mt-1.5 flex shrink-0">
                <button type="button" onClick={() => setEditing(n.id)} aria-label={`Edit ${n.title}`} className="inline-flex size-9 pointer-coarse:size-11 cursor-pointer items-center justify-center rounded-md text-ash hover:text-ink">
                  <Pencil size={14} />
                </button>
                <button type="button" onClick={() => remove(n)} aria-label={`Delete ${n.title}`} className="inline-flex size-9 pointer-coarse:size-11 cursor-pointer items-center justify-center rounded-md text-ash hover:text-danger">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            {n.body && <p className="mt-2 max-w-[65ch] whitespace-pre-line text-[15px] leading-relaxed text-body [text-wrap:pretty]">{n.body}</p>}
          </article>
        ),
      )}
      {editing === "new" ? (
        <NoteEditor onSave={create} onCancel={() => setEditing(null)} />
      ) : (
        notes.length > 0 && (
          <button type="button" onClick={() => setEditing("new")} className="-ml-2 inline-flex h-9 pointer-coarse:h-11 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-mute hover:bg-hover hover:text-ink">
            <Plus size={14} aria-hidden /> Add a note
          </button>
        )
      )}
    </div>
  );
}

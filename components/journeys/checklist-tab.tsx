import { Luggage, ListChecks, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, post } from "@/lib/client";
import { isPacking, PACK } from "@/lib/journeys/plan";
import type { Task, TripDetail } from "@/lib/journeys/types";
import { inputClass } from "../dialog";
import { Button } from "../ui";
import { AiButton, AiStatus, EmptyState, TabHead, type Generator } from "./ai-draft";
import { deadline, errorText, shortDate } from "./shared";

// The pre-trip checklist, grouped by section ("Before you go", "Bookings"),
// and the packing list, ticked off in place. Packing is the checklist's
// "Packing" section shown on a tab of its own, so agents fill it with
// add_tasks and section "Packing".

type OnTasks = (update: (t: Task[]) => Task[]) => void;

/** `sections` empty: everything goes in the Packing section and there's no section field. */
function AddTask({ journeyId, sections, onAdded }: { journeyId: string; sections: string[]; onAdded: (t: Task) => void }) {
  const packing = sections.length === 0;
  const [title, setTitle] = useState("");
  const [section, setSection] = useState(packing ? PACK : sections.includes("Before you go") ? "Before you go" : (sections[0] ?? "Before you go"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { task } = await post<{ task: Task }>(`/api/journeys/${journeyId}/tasks`, { title: title.trim(), section });
      onAdded(task);
      setTitle("");
    } catch (err) {
      setError(errorText(err, "Couldn't add it."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <div className={`grid gap-2 ${packing ? "sm:grid-cols-[minmax(0,1fr)_auto]" : "sm:grid-cols-[minmax(0,1fr)_180px_auto]"}`}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={packing ? "Add something to bring" : "Add something to do"}
          aria-label={packing ? "New packing item" : "New checklist item"}
          maxLength={200}
          className={inputClass}
        />
        {!packing && (
          <>
            <input value={section} onChange={(e) => setSection(e.target.value)} list="task-sections" aria-label="Section" maxLength={60} className={inputClass} />
            <datalist id="task-sections">
              {sections.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </>
        )}
        <Button type="submit" variant="ghost" disabled={busy || !title.trim()} className="max-sm:!h-12 sm:!h-auto">
          <Plus size={14} /> Add
        </Button>
      </div>
      {error && <p className="text-[12px] text-danger">{error}</p>}
    </form>
  );
}

/** Ticks off and removes tasks with an optimistic update. */
function useTaskActions(onTasks: OnTasks) {
  const [error, setError] = useState<string | null>(null);
  const toggle = async (t: Task) => {
    onTasks((ts) => ts.map((x) => (x.id === t.id ? { ...x, done: !t.done } : x)));
    try {
      await api(`/api/journeys/tasks/${t.id}`, { method: "PATCH", body: JSON.stringify({ done: !t.done }) });
    } catch (err) {
      onTasks((ts) => ts.map((x) => (x.id === t.id ? t : x)));
      setError(errorText(err, "Couldn't save that."));
    }
  };
  const remove = async (t: Task) => {
    try {
      await api(`/api/journeys/tasks/${t.id}`, { method: "DELETE" });
      onTasks((ts) => ts.filter((x) => x.id !== t.id));
    } catch (err) {
      setError(errorText(err, "Couldn't remove it."));
    }
  };
  return { error, toggle, remove };
}

function Progress({ done, total }: { done: number; total: number }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-elevated" aria-hidden>
      <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-[var(--ease)]" style={{ width: `${(done / total) * 100}%` }} />
    </div>
  );
}

function TaskRows({ tasks, onToggle, onRemove }: { tasks: Task[]; onToggle: (t: Task) => void; onRemove: (t: Task) => void }) {
  return (
    <ul className="mt-2 divide-y divide-hairline rounded-xl border border-hairline-strong bg-card">
      {tasks.map((t) => {
        const due = !t.done ? deadline(t.due ?? undefined) : null;
        return (
          <li key={t.id} className="group flex items-center gap-3 px-4">
            <label className="flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-3 py-3">
              <input type="checkbox" checked={t.done} onChange={() => onToggle(t)} className="size-4 shrink-0 cursor-pointer accent-[var(--accent)]" />
              <span className={`min-w-0 flex-1 text-[14px] transition-colors duration-150 ${t.done ? "text-ash line-through" : "text-ink"}`}>{t.title}</span>
              {t.due && <span className={`tnum shrink-0 text-[12px] ${due?.tone === "danger" ? "text-danger" : due?.tone === "warn" ? "text-warn" : "text-ash"}`}>by {shortDate(t.due)}</span>}
            </label>
            <button type="button" onClick={() => onRemove(t)} aria-label={`Remove ${t.title}`} className="inline-flex size-9 pointer-coarse:size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-ash hover:text-danger">
              <Trash2 size={14} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function ChecklistTab({ trip, gen, onTasks }: { trip: TripDetail; gen: Generator; onTasks: OnTasks }) {
  const { error, toggle, remove } = useTaskActions(onTasks);
  const tasks = trip.tasks.filter((t) => !isPacking(t));
  const sections = [...new Set(tasks.map((t) => t.section))];
  const done = tasks.filter((t) => t.done).length;

  return (
    <div className="space-y-6">
      <TabHead title="Checklist" sub={tasks.length ? `${done} of ${tasks.length} done` : undefined}>
        {tasks.length > 0 && <AiButton gen={gen} part="checklist" label="Add more with AI" />}
      </TabHead>
      {tasks.length > 0 && <Progress done={done} total={tasks.length} />}
      <AiStatus gen={gen} parts={["checklist"]} />
      {error && <p className="text-[13px] text-danger">{error}</p>}
      {tasks.length === 0 && (
        <EmptyState icon={<ListChecks size={18} />} title="Nothing on the checklist" body="Documents, reservations to make, things to sort before you leave. Your AI can write one for this trip, or start your own below.">
          <AiButton gen={gen} part="checklist" variant="primary" />
        </EmptyState>
      )}
      {sections.map((s) => (
        <section key={s} aria-label={s}>
          <h3 className="text-[13px] font-medium text-charcoal">{s}</h3>
          <TaskRows tasks={tasks.filter((t) => t.section === s)} onToggle={toggle} onRemove={remove} />
        </section>
      ))}
      <AddTask journeyId={trip.id} sections={sections.length ? sections : ["Before you go", "Bookings"]} onAdded={(t) => onTasks((ts) => [...ts, t])} />
    </div>
  );
}

export function PackingTab({ trip, onTasks }: { trip: TripDetail; onTasks: OnTasks }) {
  const { error, toggle, remove } = useTaskActions(onTasks);
  const items = trip.tasks.filter(isPacking);
  const packed = items.filter((t) => t.done).length;

  return (
    <div className="space-y-6">
      <TabHead title="Packing" sub={items.length ? `${packed} of ${items.length} packed` : undefined} />
      {items.length > 0 && <Progress done={packed} total={items.length} />}
      {error && <p className="text-[13px] text-danger">{error}</p>}
      {items.length === 0 ? (
        <EmptyState icon={<Luggage size={18} />} title="Nothing to pack yet" body="Add what to bring below, or ask your AI to fill in the packing list for this trip." />
      ) : (
        <TaskRows tasks={items} onToggle={toggle} onRemove={remove} />
      )}
      <AddTask journeyId={trip.id} sections={[]} onAdded={(t) => onTasks((ts) => [...ts, t])} />
    </div>
  );
}

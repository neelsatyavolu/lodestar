import Foundation

/// Item, checklist, note and budget-line writes for the trip page.
extension TripDetailModel {
    // MARK: - Items

    /// Adds an item; the server answers only an id, so the trip reloads. Returns an error to show.
    func addItem(_ item: NewItem) async -> String? {
        do {
            _ = try await app.api.send(API.Journeys.addItem(journeyId: id, item))
            await reload()
            return nil
        } catch {
            return app.handle(error)
        }
    }

    /// Any item PATCH from the UI's actions (`TripsRequests`). Returns an error to show, if any.
    @discardableResult
    func patchItem(_ itemId: String, _ patch: ItemPatch) async -> String? {
        markBusy(itemId, true)
        defer { markBusy(itemId, false) }
        do {
            let updated = try await app.api.send(API.Journeys.updateItem(itemId, patch)).item
            replaceItem(updated)
            return nil
        } catch {
            let message = app.handle(error)
            self.error = message
            return message
        }
    }

    func removeItem(_ itemId: String) async {
        markBusy(itemId, true)
        defer { markBusy(itemId, false) }
        do {
            _ = try await app.api.send(API.Journeys.deleteItem(itemId))
            adopt(trip.with(items: trip.items.filter { $0.id != itemId }))
        } catch {
            self.error = app.handle(error)
        }
    }

    /// An item PATCH may widen the trip's dates; reload the journey row when it lands outside them.
    private func replaceItem(_ updated: TripItem) {
        let items = trip.items.map { $0.id == updated.id ? updated : $0 }
        adopt(trip.with(items: items))
        let j = journey
        let outside = j.startDate.map { updated.startDate < $0 } ?? true || j.endDate.map { (updated.endDate ?? updated.startDate) > $0 } ?? true
        if updated.isLive && outside { Task { await reload() } }
    }

    // MARK: - Checklist

    func addTask(title: String, section: String) async -> String? {
        switch TripsRequests.task(title: title, section: section) {
        case .failure(let problem): return problem.message
        case .success(let body):
            do {
                let task = try await app.api.send(API.Journeys.addTask(journeyId: id, body)).task
                adopt(trip.withTasks(trip.tasks + [task]))
                return nil
            } catch {
                return app.handle(error)
            }
        }
    }

    /// Optimistic, like the web: flips at once and rolls back on failure.
    func setDone(_ task: TripTask, _ done: Bool) async {
        let before = trip.tasks
        adopt(trip.withTasks(before.map { $0.id == task.id ? $0.with(done: done) : $0 }))
        do {
            let saved = try await app.api.send(API.Journeys.updateTask(task.id, TaskPatch(done: done))).task
            adopt(trip.withTasks(trip.tasks.map { $0.id == saved.id ? saved : $0 }))
        } catch {
            adopt(trip.withTasks(before))
            self.error = app.handle(error)
        }
    }

    func deleteTask(_ taskId: String) async {
        do {
            _ = try await app.api.send(API.Journeys.deleteTask(taskId))
            adopt(trip.withTasks(trip.tasks.filter { $0.id != taskId }))
        } catch {
            self.error = app.handle(error)
        }
    }

    // MARK: - Notes

    /// A note with the same title (any case) is replaced by the server.
    func saveNote(title: String, body: String, editing noteId: String?) async -> String? {
        switch TripsRequests.note(title: title, body: body) {
        case .failure(let problem): return problem.message
        case .success(let note):
            do {
                let saved: TripNote
                if let noteId {
                    saved = try await app.api.send(API.Journeys.updateNote(noteId, NotePatch(title: note.title, body: note.body))).note
                } else {
                    saved = try await app.api.send(API.Journeys.addNote(journeyId: id, note)).note
                }
                let others = trip.notes.filter { $0.id != saved.id && $0.title.lowercased() != saved.title.lowercased() }
                adopt(trip.withNotes(others + [saved]))
                return nil
            } catch {
                return app.handle(error)
            }
        }
    }

    func deleteNote(_ noteId: String) async {
        do {
            _ = try await app.api.send(API.Journeys.deleteNote(noteId))
            adopt(trip.withNotes(trip.notes.filter { $0.id != noteId }))
        } catch {
            self.error = app.handle(error)
        }
    }

    // MARK: - Budget lines

    func addCost(label: String, amount: String, category: CostCategory) async -> String? {
        switch TripsRequests.cost(label: label, amount: amount, category: category, currency: budget.currency) {
        case .failure(let problem): return problem.message
        case .success(let body):
            do {
                let cost = try await app.api.send(API.Journeys.addCost(journeyId: id, body)).cost
                adopt(trip.withCosts(trip.costs + [cost]))
                return nil
            } catch {
                return app.handle(error)
            }
        }
    }

    func setPaid(_ cost: TripCost, _ paid: Bool) async {
        let before = trip.costs
        adopt(trip.withCosts(before.map { $0.id == cost.id ? $0.with(paid: paid) : $0 }))
        do {
            let saved = try await app.api.send(API.Journeys.updateCost(cost.id, CostPatch(paid: paid))).cost
            adopt(trip.withCosts(trip.costs.map { $0.id == saved.id ? saved : $0 }))
        } catch {
            adopt(trip.withCosts(before))
            self.error = app.handle(error)
        }
    }

    func deleteCost(_ costId: String) async {
        do {
            _ = try await app.api.send(API.Journeys.deleteCost(costId))
            adopt(trip.withCosts(trip.costs.filter { $0.id != costId }))
        } catch {
            self.error = app.handle(error)
        }
    }
}

// Copies with one part changed (the Core models are immutable).
extension TripDetail {
    func withTasks(_ tasks: [TripTask]) -> TripDetail {
        TripDetail(journey: journey, items: items, tasks: tasks, notes: notes, costs: costs)
    }

    func withNotes(_ notes: [TripNote]) -> TripDetail {
        TripDetail(journey: journey, items: items, tasks: tasks, notes: notes, costs: costs)
    }

    func withCosts(_ costs: [TripCost]) -> TripDetail {
        TripDetail(journey: journey, items: items, tasks: tasks, notes: notes, costs: costs)
    }
}

extension TripTask {
    func with(done: Bool) -> TripTask {
        TripTask(id: id, journeyId: journeyId, title: title, done: done, due: due, section: section, position: position, source: source)
    }
}

extension TripCost {
    func with(paid: Bool) -> TripCost {
        TripCost(id: id, journeyId: journeyId, label: label, amount: amount, currency: currency, category: category, paid: paid, source: source)
    }
}

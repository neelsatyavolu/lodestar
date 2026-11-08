import Foundation

extension API {
    /// Trips organizer (docs/api-trips.md sections 2-5). All need sign-in.
    enum Journeys {
        static var list: Endpoint<JourneyList> { Endpoint(method: .get, path: "/api/journeys") }

        static func create(_ body: NewJourney) -> Endpoint<CreatedID> {
            Endpoint(method: .post, path: "/api/journeys", body: body)
        }

        static func get(_ id: String) -> Endpoint<JourneyResponse> {
            Endpoint(method: .get, path: "/api/journeys/\(id)")
        }

        static func update(_ id: String, _ patch: JourneyPatch) -> Endpoint<JourneyResponse> {
            Endpoint(method: .patch, path: "/api/journeys/\(id)", body: patch)
        }

        static func delete(_ id: String) -> Endpoint<EmptyResponse> {
            Endpoint(method: .delete, path: "/api/journeys/\(id)")
        }

        /// Answers the stored item's id; reload the trip afterwards.
        static func addItem(journeyId: String, _ item: NewItem) -> Endpoint<CreatedID> {
            Endpoint(method: .post, path: "/api/journeys/\(journeyId)/items", body: item)
        }

        static func updateItem(_ itemId: String, _ patch: ItemPatch) -> Endpoint<ItemResponse> {
            Endpoint(method: .patch, path: "/api/journeys/items/\(itemId)", body: patch)
        }

        static func deleteItem(_ itemId: String) -> Endpoint<EmptyResponse> {
            Endpoint(method: .delete, path: "/api/journeys/items/\(itemId)")
        }

        static func addTask(journeyId: String, _ task: NewTask) -> Endpoint<TaskResponse> {
            Endpoint(method: .post, path: "/api/journeys/\(journeyId)/tasks", body: task)
        }

        static func updateTask(_ taskId: String, _ patch: TaskPatch) -> Endpoint<TaskResponse> {
            Endpoint(method: .patch, path: "/api/journeys/tasks/\(taskId)", body: patch)
        }

        static func deleteTask(_ taskId: String) -> Endpoint<EmptyResponse> {
            Endpoint(method: .delete, path: "/api/journeys/tasks/\(taskId)")
        }

        static func addNote(journeyId: String, _ note: NewNote) -> Endpoint<NoteResponse> {
            Endpoint(method: .post, path: "/api/journeys/\(journeyId)/notes", body: note)
        }

        static func updateNote(_ noteId: String, _ patch: NotePatch) -> Endpoint<NoteResponse> {
            Endpoint(method: .patch, path: "/api/journeys/notes/\(noteId)", body: patch)
        }

        static func deleteNote(_ noteId: String) -> Endpoint<EmptyResponse> {
            Endpoint(method: .delete, path: "/api/journeys/notes/\(noteId)")
        }

        static func addCost(journeyId: String, _ cost: NewCost) -> Endpoint<CostResponse> {
            Endpoint(method: .post, path: "/api/journeys/\(journeyId)/costs", body: cost)
        }

        static func updateCost(_ costId: String, _ patch: CostPatch) -> Endpoint<CostResponse> {
            Endpoint(method: .patch, path: "/api/journeys/costs/\(costId)", body: patch)
        }

        static func deleteCost(_ costId: String) -> Endpoint<EmptyResponse> {
            Endpoint(method: .delete, path: "/api/journeys/costs/\(costId)")
        }

        static func share(_ id: String, on: Bool) -> Endpoint<ShareResponse> {
            Endpoint(method: .post, path: "/api/journeys/\(id)/share", body: ShareRequest(on: on))
        }

        static func legs(_ id: String, date: LocalDate) -> Endpoint<LegsResponse> {
            Endpoint(method: .get, path: "/api/journeys/\(id)/legs", query: [URLQueryItem(name: "date", value: date.string)])
        }

        static func locate(_ id: String) -> Endpoint<LocateResponse> {
            Endpoint(method: .post, path: "/api/journeys/\(id)/locate", timeout: Timeouts.live)
        }

        static func deleteMail(_ mailId: String) -> Endpoint<EmptyResponse> {
            Endpoint(method: .delete, path: "/api/journeys/mail/\(mailId)")
        }

        /// Takes 30-90 s.
        static func generate(_ id: String, _ request: GenerateRequest) -> Endpoint<GenerateResponse> {
            Endpoint(method: .post, path: "/api/journeys/\(id)/generate", body: request, timeout: Timeouts.ai)
        }

        static func suggest(_ id: String, _ request: SuggestRequest) -> Endpoint<JourneyResponse> {
            Endpoint(method: .post, path: "/api/journeys/\(id)/suggest", body: request, timeout: Timeouts.ai)
        }

        static func readMail(_ provider: AIProvider) -> Endpoint<ReadMailResponse> {
            Endpoint(method: .post, path: "/api/journeys/read", body: ReadMailRequest(provider: provider), timeout: Timeouts.ai)
        }

        static func wanderlogList(session: String) -> Endpoint<WanderlogTripList> {
            Endpoint(method: .post, path: "/api/journeys/import/wanderlog",
                     body: WanderlogImportRequest(session: session), timeout: Timeouts.wanderlog)
        }

        static func wanderlogImport(session: String, keys: [String]) -> Endpoint<WanderlogImported> {
            Endpoint(method: .post, path: "/api/journeys/import/wanderlog",
                     body: WanderlogImportRequest(session: session, keys: keys), timeout: Timeouts.wanderlog)
        }
    }

    /// Saved fare watches (docs/api-trips.md section 7).
    enum SavedTrips {
        static var list: Endpoint<SavedTripList> { Endpoint(method: .get, path: "/api/trips") }

        static func save(_ request: SaveTripRequest) -> Endpoint<CreatedID> {
            Endpoint(method: .post, path: "/api/trips", body: request)
        }

        static func snapshot(_ id: String) -> Endpoint<SnapshotResponse> {
            Endpoint(method: .get, path: "/api/trips/\(id)")
        }

        static func update(_ id: String, _ patch: SavedTripPatch) -> Endpoint<SavedTripResponse> {
            Endpoint(method: .patch, path: "/api/trips/\(id)", body: patch)
        }

        static func delete(_ id: String) -> Endpoint<EmptyResponse> {
            Endpoint(method: .delete, path: "/api/trips/\(id)")
        }

        static func markBooked(_ id: String, _ booking: FareBooking) -> Endpoint<SavedTripResponse> {
            Endpoint(method: .put, path: "/api/trips/\(id)/booking", body: booking)
        }

        static func unmarkBooked(_ id: String) -> Endpoint<SavedTripResponse> {
            Endpoint(method: .delete, path: "/api/trips/\(id)/booking")
        }
    }

    /// Places (docs/api-trips.md section 6).
    enum Places {
        static func search(query: String, near: LatLng? = nil, session: String? = nil) -> Endpoint<PlaceSearchResult> {
            var items = [URLQueryItem(name: "q", value: String(query.trimmingCharacters(in: .whitespaces).prefix(120)))]
            if let near {
                items.append(URLQueryItem(name: "lat", value: String(near.lat)))
                items.append(URLQueryItem(name: "lng", value: String(near.lng)))
            }
            if let session { items.append(URLQueryItem(name: "session", value: session)) }
            return Endpoint(method: .get, path: "/api/places/search", query: items)
        }

        /// Only for "g:" ids.
        static func details(id: String, session: String? = nil) -> Endpoint<PlaceDetailsResponse> {
            var items = [URLQueryItem(name: "id", value: id)]
            if let session { items.append(URLQueryItem(name: "session", value: session)) }
            return Endpoint(method: .get, path: "/api/places/details", query: items)
        }

        /// A 302 to the image, not JSON. Load with `RemoteImage` (same cookie session).
        static func photoPath(name: String, width: Int = 640) -> String {
            var components = URLComponents()
            components.path = "/api/places/photo"
            components.queryItems = [
                URLQueryItem(name: "name", value: name),
                URLQueryItem(name: "w", value: String(min(max(width, 100), 1200))),
            ]
            return components.string ?? "/api/places/photo"
        }
    }

    /// Mail-in connectors (docs/api-trips.md section 5).
    enum Connectors {
        static var get: Endpoint<ConnectorsState> { Endpoint(method: .get, path: "/api/connectors") }

        static var newAddress: Endpoint<ForwardingAddress> {
            Endpoint(method: .post, path: "/api/connectors/address")
        }

        static var flintCode: Endpoint<FlintPairingCode> {
            Endpoint(method: .post, path: "/api/connectors/flint/code")
        }

        static func disconnectFlint(_ linkId: String) -> Endpoint<EmptyResponse> {
            Endpoint(method: .delete, path: "/api/connectors/flint/\(linkId)")
        }
    }

    /// Agent connections (docs/api-trips.md section 10).
    enum Agents {
        static var list: Endpoint<AgentsState> { Endpoint(method: .get, path: "/api/agents") }

        static func createToken(name: String) -> Endpoint<AgentTokenCreated> {
            Endpoint(method: .post, path: "/api/agents", body: NewAgentToken(name: name))
        }

        static func revoke(_ id: String) -> Endpoint<EmptyResponse> {
            Endpoint(method: .delete, path: "/api/agents/\(id)")
        }
    }
}

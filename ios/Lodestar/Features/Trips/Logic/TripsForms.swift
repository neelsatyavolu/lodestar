import Foundation

/// The "Plan a trip" / "Edit" form, validated with the server's rules and messages.
struct TripsTripForm: Equatable, Sendable {
    var title = ""
    var destination = ""
    var startDate: LocalDate?
    var endDate: LocalDate?
    var travelers = 2
    var tripType: TripType?
    /// Create only: run the full AI draft after creating.
    var draftWithAI = true
    /// Create only: "Anything it should know?" (<= 600).
    var wishes = ""

    init() {}

    init(editing j: Journey) {
        title = j.title
        destination = j.destination ?? ""
        startDate = j.startDate
        endDate = j.endDate
        travelers = j.travelers ?? 2
        tripType = j.tripType == .unknown ? nil : j.tripType
        draftWithAI = false
    }

    private static let allowed = CharacterSet.letters.union(.decimalDigits).union(CharacterSet(charactersIn: " ,.'’()-"))

    /// The first problem, as the server words it; nil when the form can be sent.
    func validate(requireDestination: Bool) -> String? {
        let place = destination.trimmingCharacters(in: .whitespaces)
        if requireDestination || !place.isEmpty {
            if place.isEmpty || place.count > 80 || !place.unicodeScalars.allSatisfy(Self.allowed.contains) {
                return "Use a place name, like Lisbon."
            }
        }
        if let s = startDate, let e = endDate, e < s { return "The trip ends before it starts." }
        if !(1...30).contains(travelers) { return "At least one traveller." }
        if title.trimmingCharacters(in: .whitespaces).count > 160 { return "Keep the name under 160 characters." }
        if wishes.count > 600 { return "Keep it under 600 characters." }
        return nil
    }

    /// `POST /api/journeys` as the web sends it.
    var newJourney: NewJourney {
        NewJourney(destination: destination.trimmingCharacters(in: .whitespaces), startDate: startDate,
                   endDate: endDate ?? startDate, title: nil, travelers: travelers, tripType: tripType)
    }

    /// The web's Edit sends all six fields.
    func patch(current: Journey) -> JourneyPatch {
        let name = title.trimmingCharacters(in: .whitespaces)
        let place = destination.trimmingCharacters(in: .whitespaces)
        return JourneyPatch(
            title: name.isEmpty ? current.title : name,
            destination: .some(place.isEmpty ? nil : place),
            startDate: .some(startDate),
            endDate: .some(endDate ?? startDate),
            travelers: .some(travelers),
            tripType: .some(tripType)
        )
    }

    var wantsDraft: Bool { draftWithAI && startDate != nil }
}

/// The "Add" dialog on a trip (kinds the web offers, with its labels).
struct TripsAddItemForm: Equatable, Sendable {
    enum Choice: String, CaseIterable, Identifiable, Sendable {
        case activity, dining, stay, flight, transport, rentalCar

        var id: String { rawValue }

        var label: String {
            switch self {
            case .activity: "Something to do"
            case .dining: "Restaurant"
            case .stay: "Place to stay"
            case .flight: "Flight"
            case .transport: "Train, car or transfer"
            case .rentalCar: "Rental car"
            }
        }

        var kind: ItemKind {
            switch self {
            case .activity: .activity
            case .dining: .dining
            case .stay: .stay
            case .flight: .flight
            case .transport, .rentalCar: .transport
            }
        }
    }

    var choice: Choice = .activity
    var title = ""
    var startDate: LocalDate
    var hasTime = false
    var time = "12:00"
    var endDate: LocalDate?
    var place = ""
    var confirmation = ""
    var booked = false

    init(choice: Choice = .activity, day: LocalDate) {
        self.choice = choice
        self.startDate = day
        if choice == .rentalCar { title = "Rental car" }
        if choice == .stay { endDate = day.adding(days: 1) }
    }

    func validate() -> String? {
        let name = title.trimmingCharacters(in: .whitespaces)
        if name.isEmpty { return "Give it a name." }
        if name.count > 160 { return "Keep the name under 160 characters." }
        if let end = endDate, end < startDate { return "It ends before it starts." }
        if confirmation.trimmingCharacters(in: .whitespaces).count > 40 { return "Confirmation numbers are 40 characters at most." }
        if place.count > 160 { return "Keep the place under 160 characters." }
        return nil
    }

    /// `{kind, status: booked||confirmation ? "booked":"planned", title, startDate, startTime|null, endDate|null, place|null, confirmation|null}`.
    var newItem: NewItem {
        let code = confirmation.trimmingCharacters(in: .whitespaces)
        let where_ = place.trimmingCharacters(in: .whitespaces)
        return NewItem(
            kind: choice.kind,
            status: booked || !code.isEmpty ? .booked : .planned,
            title: title.trimmingCharacters(in: .whitespaces),
            startDate: startDate,
            startTime: hasTime && choice != .stay ? time : nil,
            endDate: endDate,
            place: where_.isEmpty ? nil : where_,
            confirmation: code.isEmpty ? nil : code
        )
    }
}

enum TripsRequests {
    /// "Add a place" from a picked search result (contract 3.4).
    static func placeItem(_ s: PlaceSuggestion, details: PlaceDetails?, day: LocalDate, now: Date = .now) -> NewItem {
        let kind: ItemKind = switch details?.kind ?? s.kind {
        case .dining: .dining
        case .stay: .stay
        default: .activity
        }
        var d = ItemDetails()
        d.placeId = s.id
        d.address = details?.address ?? s.address
        let location = details?.location ?? s.location
        if let location {
            d.lat = location.lat
            d.lng = location.lng
            d.locatedAt = EpochMillis.from(now)
        }
        d.url = details?.mapsUrl
        d.rating = details?.rating
        let city = s.secondary.split(separator: ",").first.map { $0.trimmingCharacters(in: .whitespaces) }
        return NewItem(kind: kind, status: .planned, title: String((details?.name ?? s.name).prefix(160)), startDate: day,
                       endDate: kind == .stay ? day.adding(days: 1) : nil,
                       place: (city?.isEmpty ?? true) ? nil : city, details: d)
    }

    /// "Add a place" with free text: a note on that day.
    static func noteItem(_ text: String, day: LocalDate) -> NewItem {
        NewItem(kind: .note, status: .planned, title: String(text.trimmingCharacters(in: .whitespaces).prefix(160)), startDate: day)
    }

    /// Pin an item to a picked place.
    static func pin(_ s: PlaceSuggestion, details: PlaceDetails?) -> ItemPatch? {
        guard let location = details?.location ?? s.location else { return nil }
        var patch = ItemPatch()
        patch.location = ItemLocation(placeId: s.id, lat: location.lat, lng: location.lng, address: details?.address ?? s.address)
        return patch
    }

    static func status(_ status: ItemStatus) -> ItemPatch {
        var p = ItemPatch()
        p.status = status
        return p
    }

    static var needsBooking: ItemPatch {
        var p = ItemPatch()
        p.facts = ItemFacts(reserve: .some(true))
        return p
    }

    static var doesNotNeedBooking: ItemPatch {
        var p = ItemPatch()
        p.facts = ItemFacts(reserve: .some(nil), bookBy: .some(nil))
        return p
    }

    static func bookBy(_ day: LocalDate?) -> ItemPatch {
        var p = ItemPatch()
        p.facts = ItemFacts(bookBy: .some(day))
        return p
    }

    /// The To book "Mark booked" dialog. Returns the error to show or the patch.
    static func markBooked(confirmation: String, paid: String) -> Result<ItemPatch, TripsProblem> {
        let code = confirmation.trimmingCharacters(in: .whitespaces)
        if code.count > 40 { return .failure(TripsProblem(message: "Confirmation numbers are 40 characters at most.")) }
        let paidText = paid.trimmingCharacters(in: .whitespaces)
        var p = ItemPatch()
        p.status = .booked
        p.confirmation = .some(code.isEmpty ? nil : code)
        if paidText.isEmpty {
            p.facts = ItemFacts()
        } else {
            guard let price = FareWatchText.parseDollars(paidText), price >= 0, price <= 1_000_000 else {
                return .failure(TripsProblem(message: "Enter what you paid, like 120."))
            }
            p.facts = ItemFacts(estimate: .some(nil), price: .some(price))
        }
        return .success(p)
    }

    static func day(_ day: LocalDate) -> ItemPatch {
        var p = ItemPatch()
        p.startDate = day
        return p
    }

    static func time(_ hhmm: String?) -> ItemPatch {
        var p = ItemPatch()
        p.startTime = .some(hhmm)
        return p
    }

    static func note(_ text: String) -> ItemPatch {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        var p = ItemPatch()
        p.note = .some(trimmed.isEmpty ? nil : String(trimmed.prefix(2000)))
        return p
    }

    static func move(to journeyId: String) -> ItemPatch {
        var p = ItemPatch()
        p.journeyId = .some(journeyId)
        return p
    }

    static func task(title: String, section: String) -> Result<NewTask, TripsProblem> {
        let name = title.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return .failure(TripsProblem(message: "Say what to do.")) }
        guard name.count <= 200 else { return .failure(TripsProblem(message: "Keep it under 200 characters.")) }
        let s = section.trimmingCharacters(in: .whitespaces)
        return .success(NewTask(title: name, due: nil, section: s.isEmpty ? "Before you go" : String(s.prefix(60))))
    }

    static func cost(label: String, amount: String, category: CostCategory, currency: String) -> Result<NewCost, TripsProblem> {
        let name = label.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return .failure(TripsProblem(message: "Say what it's for.")) }
        guard let value = FareWatchText.parseDollars(amount), value >= 0, value <= 1_000_000 else {
            return .failure(TripsProblem(message: "Enter an amount, like 40."))
        }
        return .success(NewCost(label: String(name.prefix(120)), amount: value, currency: currency, category: category, paid: false))
    }

    static func note(title: String, body: String) -> Result<NewNote, TripsProblem> {
        let name = title.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return .failure(TripsProblem(message: "Give the note a title.")) }
        return .success(NewNote(title: String(name.prefix(120)), body: String(body.prefix(8000))))
    }
}

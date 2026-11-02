import { describe, expect, it } from "vitest";
import { jsonLdNodes, reservationsFromHtml, splitLocal } from "./jsonld";

const wrap = (data: unknown, attrs = 'type="application/ld+json"') => `<html><body><p>Hi</p><script ${attrs}>${JSON.stringify(data)}</script></body></html>`;

const flight = {
  "@context": "http://schema.org",
  "@type": "FlightReservation",
  reservationNumber: "RXJ34P",
  reservationStatus: "http://schema.org/ReservationConfirmed",
  reservationFor: {
    "@type": "Flight",
    flightNumber: "UA110",
    airline: { "@type": "Airline", name: "United", iataCode: "UA" },
    departureAirport: { "@type": "Airport", iataCode: "SFO" },
    departureTime: "2027-03-01T10:15:00-08:00",
    arrivalAirport: { "@type": "Airport", iataCode: "NRT" },
    arrivalTime: "2027-03-02T14:40:00+09:00",
  },
};

describe("schema.org reservations", () => {
  it("keeps the local wall-clock time the confirmation states", () => {
    expect(splitLocal("2027-03-01T10:15:00-08:00")).toEqual({ date: "2027-03-01", time: "10:15" });
    expect(splitLocal("2027-03-01")).toEqual({ date: "2027-03-01", time: null });
    expect(splitLocal("soon")).toBeNull();
  });

  it("reads a flight with its airline, number, airports and confirmation", () => {
    const [item] = reservationsFromHtml(wrap(flight));
    expect(item).toMatchObject({
      kind: "flight",
      status: "booked",
      title: "UA 110 · SFO → NRT",
      startDate: "2027-03-01",
      startTime: "10:15",
      endDate: "2027-03-02",
      endTime: "14:40",
      place: "Tokyo",
      confirmation: "RXJ34P",
      details: { airline: "United", flightNumber: "UA 110", from: "SFO", to: "NRT" },
    });
  });

  it("does not mistake a bare number's digits for an airline code", () => {
    const [item] = reservationsFromHtml(wrap({ ...flight, reservationFor: { ...flight.reservationFor, flightNumber: "110" } }));
    expect(item.details.flightNumber).toBe("UA 110");
  });

  it("marks a cancellation", () => {
    const [item] = reservationsFromHtml(wrap({ ...flight, reservationStatus: "http://schema.org/ReservationCancelled" }));
    expect(item.status).toBe("cancelled");
  });

  it("reads a hotel stay, a restaurant booking and an event from one @graph", () => {
    const html = wrap({
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "LodgingReservation",
          reservationNumber: "88812",
          checkinTime: "2027-03-02T15:00:00+09:00",
          checkoutTime: "2027-03-06T11:00:00+09:00",
          reservationFor: { "@type": "LodgingBusiness", name: "Hotel Gracery", address: { streetAddress: "1-19-1 Kabukicho", addressLocality: "Tokyo", addressCountry: "JP" }, telephone: "+81 3 6833 2489" },
        },
        { "@type": "FoodEstablishmentReservation", startTime: "2027-03-03T19:30:00", partySize: 2, reservationFor: { "@type": "FoodEstablishment", name: "Sushi Saito", address: "Minato, Tokyo" } },
        { "@type": "EventReservation", reservationFor: { "@type": "Event", name: "teamLab Planets", startDate: "2027-03-04T10:00", location: { name: "Toyosu", address: { addressLocality: "Tokyo" } } } },
      ],
    });
    const items = reservationsFromHtml(html);
    expect(items.map((i) => i.kind)).toEqual(["stay", "dining", "activity"]);
    expect(items[0]).toMatchObject({ title: "Hotel Gracery", startDate: "2027-03-02", endDate: "2027-03-06", place: "Tokyo", confirmation: "88812", details: { address: "1-19-1 Kabukicho, Tokyo, JP" } });
    expect(items[1]).toMatchObject({ title: "Sushi Saito", startTime: "19:30", details: { guests: 2, address: "Minato, Tokyo" } });
    expect(items[2]).toMatchObject({ title: "teamLab Planets", place: "Tokyo", status: "booked" });
  });

  it("reads rental cars and trains", () => {
    const items = reservationsFromHtml(
      wrap([
        { "@type": "RentalCarReservation", reservationNumber: "C1", pickupTime: "2027-03-05T09:00", dropoffTime: "2027-03-07T09:00", pickupLocation: { name: "Hertz Shinjuku", address: { addressLocality: "Tokyo" } }, reservationFor: { "@type": "Car", rentalCompany: { name: "Hertz" } } },
        { "@type": "TrainReservation", reservationFor: { "@type": "TrainTrip", departureStation: { name: "Tokyo" }, arrivalStation: { name: "Kyoto" }, departureTime: "2027-03-06T08:00", trainCompany: { name: "JR Central" } } },
      ]),
    );
    expect(items.map((i) => i.title)).toEqual(["Hertz pickup", "JR Central · Tokyo → Kyoto"]);
  });

  it("survives HTML-escaped markup, comments and garbage", () => {
    const escaped = `<script type="application/ld+json">${JSON.stringify(flight).replace(/"/g, "&quot;")}</script><script type="application/ld+json">{not json</script>`;
    expect(reservationsFromHtml(escaped)).toHaveLength(1);
    expect(reservationsFromHtml("<p>no markup</p>")).toEqual([]);
    expect(jsonLdNodes(wrap({ "@type": "Organization" }))).toHaveLength(1);
  });

  it("drops reservations missing a date or a place", () => {
    expect(reservationsFromHtml(wrap({ ...flight, reservationFor: { ...flight.reservationFor, departureTime: undefined } }))).toEqual([]);
    expect(reservationsFromHtml(wrap({ "@type": "LodgingReservation", reservationFor: { name: "X" } }))).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { restaurantReservation } from "./restaurants";

// Trimmed from real confirmations, as htmlToText leaves them.

const SENT = Date.UTC(2026, 10, 5); // Nov 5, 2026

const RESY = `Right This Way
Dept. of Reservations
Reservation booked.
5 Points
Sun, Nov. 22 at 6:00pm
4 Guests, Dining Room
Manage Reservation
Cancel
Add to Calendar
Thank you for making a reservation.
We will hold your table for 15 minutes, so please call +1 520-623-3888 if you're running late.
Cancellation Policy
A cancellation fee will not be charged if you cancel before Sun, Nov. 22 at 5:45pm.
Download our app to set dining preferences and invite friends on the go.
5 Points
756 S Stone Ave
(Between Stone Avenue and 18th Street)
Tucson, AZ 85701
Get Directions
+1 520-623-3888
https://www.5pointstucson.com
This is a servicing communication sent by Resy Network Inc, 200 Vesey Street, New York, NY 10285.`;

const OPENTABLE = `[Reservation confirmed] Thanks for using OpenTable!
Reservation confirmed
Thanks for using OpenTable!
Bottega Michelangelo
Table for 4 on Wednesday, November 25, 2026 at 6:15 pm
Name : Traveller
Confirmation # : 2110028985
See menu | Get directions
420 W Magee Rd
Tucson, AZ 85704
Phone: (520) 297-5775
Calendar
Modify
Cancel`;

const YELP = `Hi there, thank you for making a reservation at Saffron Indian Bistro !
Party of 4
Monday, November 23
at 6:15PM
Saffron Indian Bistro
7607 N Oracle Rd
Oro Valley AZ
(520) 742-9100
Edit this reservation
Cancel this reservation
© 2026 | Yelp Inc, 350 Mission Street, San Francisco, CA 94105, USA`;

describe("restaurant confirmations", () => {
  it("reads a Resy booking, placing the yearless date after the email was sent", () => {
    expect(restaurantReservation(RESY, SENT)).toEqual({
      kind: "dining",
      status: "booked",
      title: "5 Points",
      startDate: "2026-11-22",
      startTime: "18:00",
      endDate: null,
      endTime: null,
      place: "Tucson",
      confirmation: null,
      details: { provider: "Resy", guests: 4, address: "756 S Stone Ave, Tucson, AZ 85701", phone: "+1 520-623-3888", url: "https://www.5pointstucson.com" },
    });
  });

  it("reads an OpenTable booking with its confirmation number", () => {
    const item = restaurantReservation(OPENTABLE, SENT);
    expect(item).toMatchObject({ title: "Bottega Michelangelo", startDate: "2026-11-25", startTime: "18:15", place: "Tucson", confirmation: "2110028985", status: "booked" });
    expect(item?.details).toEqual({ provider: "OpenTable", guests: 4, address: "420 W Magee Rd, Tucson, AZ 85704", phone: "(520) 297-5775" });
  });

  it("reads a Yelp booking", () => {
    expect(restaurantReservation(YELP, SENT)).toMatchObject({
      title: "Saffron Indian Bistro",
      startDate: "2026-11-23",
      startTime: "18:15",
      place: "Oro Valley",
      details: { provider: "Yelp", guests: 4, address: "7607 N Oracle Rd, Oro Valley AZ", phone: "(520) 742-9100" },
    });
  });

  it("reads a forwarded confirmation the same way", () => {
    const forwarded = `Begin forwarded message:\nFrom: OpenTable <no-reply@opentable.com>\nSubject: Your reservation confirmation\n${OPENTABLE}`;
    expect(restaurantReservation(forwarded, SENT)?.confirmation).toBe("2110028985");
  });

  it("marks a cancellation", () => {
    expect(restaurantReservation(OPENTABLE.replace("[Reservation confirmed]", "[Reservation cancelled]"), SENT)?.status).toBe("cancelled");
    expect(restaurantReservation(RESY.replace("Reservation booked.", "Reservation canceled."), SENT)?.status).toBe("cancelled");
  });

  it("puts a January table booked in December in the next year", () => {
    expect(restaurantReservation(RESY.replace("Sun, Nov. 22", "Sat, Jan. 9"), Date.UTC(2026, 11, 20))?.startDate).toBe("2027-01-09");
  });

  it("refuses a day that doesn't exist", () => {
    expect(restaurantReservation(OPENTABLE.replace("November 25, 2026", "February 31, 2026"), SENT)).toBeNull();
  });

  it("ignores mail that isn't a confirmation", () => {
    expect(restaurantReservation("Thanks for dining with OpenTable! Rate your meal.", SENT)).toBeNull();
    expect(restaurantReservation("Resy picks: the best new restaurants this week", SENT)).toBeNull();
  });
});

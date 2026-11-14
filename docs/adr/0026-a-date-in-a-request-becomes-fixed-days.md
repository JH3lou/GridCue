# A date in a request becomes fixed days

**Status:** accepted with the named filters spec (2026-11-13). Not yet built.

A relative date in a request, such as "last 90 days" or "this quarter", is worked out once, when the request is made. The view keeps the two dates as an ordinary filter. The Preview shows the dates first and the words after: "Filter Opened date from 2026-08-15 to 2026-11-13 (last 90 days)".

Before this, GridCue read one ISO date with a comparison and nothing else. With the Mock Provider, "opened in the last 90 days" asked, and "taxable accounts opened this quarter" previewed the Taxable filter alone. Nothing was run with Jev. The package had no clock and no time zone. Cells were compared as text, so "after 2026-01-31" on a date-and-time column kept a row stamped on the 31st (named filters grill, 2026-11-13).

What is decided:

- **The view keeps the dates, not the words.** The View State is the record (ADR 0021), and a record that means something else tomorrow is not one. The View State, the protocol and the Grid Adapter interface are unchanged. The plan's evidence keeps the words.
- **The forms are a closed list, each with one meaning.** "Last N days" runs from N days before today through today. "This quarter" is the whole quarter that holds today. Any other time word asks and is never dropped: a month name, a slash date, "90 days ago", "this week".
- **A date in a filter means the whole day,** on date and date-and-time columns alike. A date-and-time cell is on the day its instant falls on in the Calendar's time zone. Both Grid Adapters keep the same rows.
- **The Calendar is in the View Schema.** It holds the Host's time zone and the first month of its year, and quarters and years follow that month. The time zone defaults to the browser's, taken when a request is read and never when the schema is built. The Calendar is not sent to an Intent Provider.
- **The clock is on the Controller.** It defaults to the system clock. Only the Controller reads a request, so only it needs one.

The alternative was a relative value in the View State, worked out each time the grid filters. That needs a new filter value in the protocol, and a clock in every Grid Adapter and in every Host that filters its rows on a server.

The cost is real. A saved "last 90 days" view shows the same dates next month, and the User asks again. A Host that books its data in one time zone, with Users in another, can show a view that is off by a day unless it sets the time zone. The Preview shows the dates, and names the zone on a date-and-time column, so the surprise is visible.

What would change it:

- Hosts ask for saved views that roll forward. The protocol then gains a relative value, and the words kept in evidence say what was meant.
- A Host reports a view off by a day. Relative dates then stay off until the Host sets the time zone.
- A held-out set shows Users mean two things by a listed form. That form then asks.
- Hosts want "this week" and "last week". Both ask, because the Calendar holds no first day of the week. They can be added on their own held-out set.

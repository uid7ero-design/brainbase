# Shared Coach workspace

## Run a class

1. Open **Scheduling → Coaching workspace** and create a group schedule. Open the schedule and add an offering with a name, duration, capacity and price.
2. From **Coach → Weekly class calendar**, choose the offering, location if applicable, local date and start time. Use **Show week** to move directly to the date. Each entry shows the schedule time zone and places filled.
3. Open the class name to see its roster. Managers with staff booking enabled can enrol a participant by name and email. To open self-service booking, enable the schedule’s public booking link and share the resulting URL. The link lists scheduled classes starting in the next 90 days. Disable it to close that link to new bookings.
4. Use the roster to mark attendance or cancel an unpaid enrolment whose attendance is still unmarked. A cancellation frees the place and keeps the entry in the roster history.

## Run a weekly term

1. In **Weekly class calendar**, choose **Weekly term** under **Schedule type**. Choose the class and location, then enter the first class date, local start time, term name and inclusive end date. Select **Create term**. The calendar shows the term name on each weekly class. Terms cover two to 26 dates; the end date can fall between classes.
2. Open the roster on the date the participant will join. Enter their name and email, then choose **Remaining term** under **Enrolment covers**. Check the number of classes, last date and fee per class before selecting **Enrol participant**. Earlier dates and other terms are excluded. The series is closed to further generation as soon as all selected reservations are saved.
3. Each booked date has its own attendance and unpaid booking record. Cancelling an eligible enrolment from a roster affects only that date. Public booking links continue to book one date at a time.

If a date conflicts with a saved class or resource hold, term creation rolls back. A full date or existing booking for that email blocks the whole enrolment. Review the saved rosters before retrying. Choose a different start time if a weekly class would fall at a skipped or repeated local time during a daylight-saving change.

The release requires the additive schema in `scripts/create-coach-terms.sql` before deploying the application. Existing single classes have no term membership.

### Use existing LD Tennis dates

After the Tennis cutover, open an existing class in the shared weekly calendar. The roster includes the original bookings, attendance, weekly enrolments, payment markers and imported cancellation history. Earlier weeks and archived classes remain available in the calendar.

From the first upcoming class, use **Group existing dates into a term**, name the term and choose its last scheduled class. The count covers the same class, weekday, time and location. Cancelled dates are skipped and an existing term ends the available range. To schedule further Tennis dates, use the existing Tennis class management screen to generate them first. Grouping only links dates and leaves the original class and player records in place.

Open the joining date, then use **Enrol participant** for the remaining term when staff booking is enabled. The Tennis roster retains its existing one-off and open-ended weekly enrolment controls. The Tennis public booking page keeps its existing address.

One-to-one appointments remain available from the Coach workspace through Scheduling.

## Operational boundaries

The class date, roster and public link use the organisation’s existing Scheduling records. View-only users see calendar counts. Participant identities require staff roster access. Public and staff bookings use the same database capacity guard. A public link starts disabled. A fresh link is generated after disabling and re-enabling publication.

A confirmed booking records the quoted price with unpaid status. Invoices, receipts and expenses remain in Commercial under its own access controls. If a booking response is interrupted, the coach can check the roster before taking another action.

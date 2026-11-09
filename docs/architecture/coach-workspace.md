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

### Example for a gymnastics coach

Create a group schedule called **Junior gymnastics** and a **Floor skills** offering. To reserve the gym floor for each class, add it as a Scheduling resource of kind **Space** and link it to the offering. In the Coach calendar, choose **Weekly term**, select Floor skills at that location, and enter the first and last dates.

For a gymnast joining in week two, open the second class roster and choose **Remaining term**. Mark attendance on each class roster. Reopening an earlier week from the calendar shows that week's attendance, including the original roster from before the gymnast joined.

### Run a football team or tennis squad

Open **Coach → Teams and squads**, create the squad and select its name. Add each player once with their booking email and joining date. From the weekly calendar, create a training term using the club's group offering and playing space (for example, **U12 training** at **Pitch 2**). Return to the squad, review the dates and fee per class, and select **Assign training term**. Assign the next term to the same squad to carry its membership forward. This also works with a shared Coach tennis offering. Imported LD Tennis terms keep their existing enrolment controls.

The calendar and class rosters show the squad name. Membership creates ordinary unpaid bookings on eligible upcoming dates. A full class or a conflicting booking blocks the entire change. The existing booking system uses one email per active place per class. A coach can still mark attendance or cancel an individual date on its roster.

To leave or switch teams, open **End or transfer membership**, choose the first date outside the old squad and, for a transfer, the destination squad. Earlier attendance stays on the original roster. Future unpaid, unmarked squad bookings are cancelled from that date. A transfer books eligible destination dates in the same transaction. A conflict or a past, marked or paid booking that would need changing blocks the change. Independently booked places are managed on their class rosters.

The squad screen requires Scheduling management and staff booking access. Apply `scripts/create-coach-squads.sql` after the Coach terms schema before deploying this feature.

### Plan and run a training session

From the weekly calendar, open a class roster and select **Training plan**. Give the first drill a name and duration. Add coaching notes and use **Add drill** for each activity. The total shows how much of the booked session is planned. Use **Move earlier** to reorder a drill.

Choose **Football pitch**, **Football half-pitch**, **Tennis court** or **Blank space** for each drill. Under **Place on board**, select a rostered player, cone or ball and choose a spot. Select a player again to move them. A movement arrow takes two spots, start and end. **Erase at position** clears a spot. Each drill keeps its own positions.

Select **Save plan**, then **Run session** to step through the drills in order. Managers can edit until the scheduled session ends. Earlier saved plans remain available to authorised roster staff. If another coach saves first, reload to review their version before editing.

To reuse a plan, enter a template name before saving. Templates are shared within the organisation. They copy coaching notes and convert rostered players to anonymous position markers. Open another session, choose the template, adjust its drills and save. This feature requires the separate local migration in `scripts/create-coach-training-plans.sql`.

### Review the coaching week

Open **Coach → Weekly coaching review**. **Attendance to finish** lists ended classes with confirmed places awaiting an attendance mark. Open a roster to record attendance, then reopen the review to see the updated totals. Attended, late and absent marks are counted separately. Cancelled classes and cancelled bookings are excluded.

**Session preparation** lists upcoming and in-progress classes with their saved-plan status. Choose **Prepare plan** or **Open plan** to go directly to the session. Use **Previous week** for attendance history or **Next week** to prepare. The review uses each class's local date and time and is available to scheduling managers.

### Use existing LD Tennis dates

After the Tennis cutover, open an existing class in the shared weekly calendar. The roster includes the original bookings, attendance, weekly enrolments, payment markers and imported cancellation history. Earlier weeks and archived classes remain available in the calendar.

From the first upcoming class, use **Group existing dates into a term**, name the term and choose its last scheduled class. The count covers the same class, weekday, time and location. Cancelled dates are skipped and an existing term ends the available range. To schedule further Tennis dates, use the existing Tennis class management screen to generate them first. Grouping only links dates and leaves the original class and player records in place.

Open the joining date, then use **Enrol participant** for the remaining term when staff booking is enabled. The Tennis roster retains its existing one-off and open-ended weekly enrolment controls. The Tennis public booking page keeps its existing address.

One-to-one appointments remain available from the Coach workspace through Scheduling.

## Operational boundaries

The class date, roster and public link use the organisation’s existing Scheduling records. View-only users see calendar counts. Participant identities require staff roster access. Public and staff bookings use the same database capacity guard. A public link starts disabled. A fresh link is generated after disabling and re-enabling publication.

A confirmed booking records the quoted price with unpaid status. Invoices, receipts and expenses remain in Commercial under its own access controls. If a booking response is interrupted, the coach can check the roster before taking another action.

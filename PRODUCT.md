# myOS
<!-- impeccable:product-schema 1 -->
## Platform
web
## Users and purpose
A personal workbench for organizing projects and tasks. The user needs one page to understand project → topic → task ownership and scan task status, type, and update dates.
## Confirmed scope
The user approved the split graph/list preview on 2026-10-19 and authorized implementation and production deployment. Preserve real records, full task details, execution controls, recurring tasks, and existing permissions. Use the existing standalone Life OS deployment, not the retired HappySpa embedded copy.
## Constraints
Next.js/React with an authenticated Node/SQLite gateway. Topic assignment must persist on the server. Existing unclassified records remain unclassified; never infer business ownership. The approved image contains illustrative data only.

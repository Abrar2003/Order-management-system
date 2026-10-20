# 1. Scope, snapshot and reading guide

**14 October 2026 update:** the optional Timber Trace review layer is now implemented in this checkout behind `EUDR_REVIEW_LAYER=false`. See [EUDR_REVIEW_IMPLEMENTATION.md](EUDR_REVIEW_IMPLEMENTATION.md) for its network-level decision, species/HS metadata, parties/plots, provider checks, request letters, Europe reports, migration, tests and exact file manifest. The historical context below describes the earlier inventory baseline. No production migration or deployment has been performed.

This is the full functional and technical context of EUDR Timber Management in the Green House Sourcing Order Management System (OMS), based on the repository on 13 October 2026. It covers the original container-centric stage workflow and the integrated documentary inventory and global quantity reconciliation extension. It describes code present in this working checkout, including local changes; it is not a statement that these changes are already deployed or that a production database has been migrated.

The actual code is authoritative. The supplied EUDR Management Summary and EUDR Schema and System Design documents describe the earlier baseline. The implementation guide describes the recent inventory extension. This reference brings both operational layers together and records UI limitations explicitly rather than presenting the original implementation prompt as completed functionality.

Read chapters 2-14 for business and UI behavior, chapters 15-21 for technical rules and operations, and the generated schema appendix for every persisted EUDR field, nested field and declared index. Supporting Order, Sample, Item and Vendor schemas are covered only to the extent consumed by EUDR; unrelated OMS modules are outside this reference.

Important terminology: a documented quantity is evidence-backed quantity recorded in OMS. Committed quantity means documentary capacity used or reserved within OMS. Uncommitted documentary capacity is not confirmed stock held by an external sawmill, trader or manufacturer. Quantity Feasible means a simultaneous mathematical solution exists; it does not prove physical composition, forest origin, legality or EUDR compliance.

The PDF contains native diagrams and current UI screenshots from isolated browser fixtures. These screenshots illustrate the implemented interface using synthetic test data, not real business records. Source files and schema definitions are listed at the end for future maintenance.

# 2. System architecture and record ownership

The frontend is React with Vite. The backend is Node.js and Express with MongoDB/Mongoose. Private evidence is stored in S3-compatible Wasabi storage. Existing authentication, role normalization, upload middleware, PDF rendering and Office conversion are reused.

There are two related views of the same traceability information. EudrChain is a container/vendor-specific ordered review with embedded evidence snapshots and history. The inventory ledger is a global documentary transaction network: one canonical invoice, production source or incoming transfer may be referenced by many chains without recreating its quantity.

The frontend route is /eudr, reached from the EUDR Timber Management navigation item. The backend mounts its router at /eudr. Static /container, /directory and /inventory routes precede the dynamic /:id route, so inventory resource names are not interpreted as chain IDs.

[[ARCHITECTURE]]

| Record | Owns | Does not establish |
| EudrChain | Container contribution, ordered review and local evidence snapshots | Another independent copy of an invoice entitlement |
| Canonical invoice | Permanent issuer/FY/number identity and line quantity caps | Physical stock or a verified incoming receipt by itself |
| Production source | One separately evidenced root quantity and origin set | Automatic legal clearance or cutting-limit production |
| Receipt lot | One holder's supported incoming quantity and availability | Extra capacity whenever selected in another chain |
| Transfer | One seller outgoing movement and its buyer receipt | Repeated upstream consumption for each later container |
| Mix | Logical grouping or physical-mixing evidence | A new independent lot or an additional supply balance |
| Commitment | One chain's allocation from one or more finished lots | A second count of that contribution in container coverage |

Production and receipt records have stable MongoDB IDs. Source and operation references are not party-directory identities. A directory update does not silently rewrite historical issuer, buyer or holder snapshots.

# 3. Access, roles and action boundaries

EUDR is available to admin, super_admin and manager after authentication. The frontend restricts access and the backend independently enforces the same normalized roles. Other roles cannot use the EUDR APIs, including graph and private document endpoints.

| Action | Admin / super_admin | Manager | Other roles |
| View chains, inventory, lineage, files and history | Allowed | Allowed | Denied |
| Create/save stages, upload evidence and manually verify | Allowed | Allowed | Denied |
| Register invoices, sources, sales, mixes and reservations | Allowed when rollout permits | Allowed when rollout permits | Denied |
| Correct canonical quantities/evidence | Allowed with revision, reason and evidence | Denied | Denied |
| Cancel/reverse records or release commitments | Allowed with controlled dependency checks | Denied | Denied |
| Import a reviewed historical network | Allowed through administrative API | Denied | Denied |
| Run migration/index tooling | Operator action outside UI | Not a UI permission | Not exposed by UI |

Authenticated access does not make client-submitted seller identities, storage keys or verification flags authoritative. Services load party identities from existing records, validate document IDs and use the authenticated actor for audit. Public inventory serialization removes private storage keys.

All EUDR responses are marked private/no-store. Document content additionally varies on Cookie and Authorization. Signed original links expire after 300 seconds and should be treated as sensitive temporary access links.

Once persistent inventory enforcement is active, switching environment flags off does not reopen the old clearance path. Mutation requests fail closed if canonical ownership is disabled or ledger state cannot be checked. Read access to historical records remains available.

# 4. Containers home screen and vendor selection

The top-level screen is EUDR Timber Management, with Containers and Inventory section buttons. Opening a chain replaces the section workspace with its chain report. Back to Containers reloads the container lookup and recent chains.

| Control / display | Behavior |
| Container number | Required text input; leading/trailing spaces are trimmed for lookup |
| Find shipments | Searches matching Order and Sample shipment entries, case-insensitively |
| Vendor cards | One group per resolved shipping vendor, with GST, PAN, shipment count and stuffed CFT |
| Coverage indicator | Shows allocated, verified, required and unallocated CFT, plus complete/incomplete |
| Unassigned warning | Flags shipments without one unambiguous vendor; final declaration is blocked |
| Missing Timber_CFT warning | Shows excluded lines and explains that the displayed total is partial |
| Legacy review warning | Shows legacy contributions still requiring inventory review in a mixed-standard group |
| Open chain | Opens an existing chain for the selected container/vendor |
| Container/vendor declared CFT | Must exactly match the live calculated stuffed total |
| This chain's CFT contribution | Positive, up to three decimals, no greater than unallocated coverage |
| Start chain | Creates one contribution; disabled on mismatch, invalid quantity, missing identifiers or busy state |
| Recent chains | Latest 50 chains, showing container, vendor, declaration, contribution, status and Open |

Multiple chains may contribute to a single container/vendor. Each chain's declared amount is the same container/vendor total; its contribution is only its own share. A chain may be verified without the whole container/vendor being fully covered.

The legacy recent-chain list has a 50-result ceiling without pagination. The new inventory registry is independently paginated and does not inherit that ceiling. No container-wide delete or unrestricted adjustment control exists in this screen.

# 5. Stuffed timber calculation and coverage

Order shipments obtain per-unit timber_cft from the Item identified by item.item_code. Sample shipments obtain timber_cft directly from the Sample. Only positive matching shipment quantities contribute. Vendor references are resolved by ID, or by a unique case-insensitive exact name when an ID is absent. A sample with multiple vendor references is not arbitrarily assigned to one vendor.

The authoritative helper first converts per-unit CFT to milli-CFT and rounds each shipment line after multiplication by shipment quantity. It then sums integer line values with safe-integer overflow checks. It does not sum floating-point line CFT and round only at the end.

Example: per-unit 1.125 CFT and shipment quantity 12 gives 1,125 milli-CFT x 12 = 13,500 milli-CFT, displayed as 13.500 CFT. Numeric zero is valid timber data; null, missing or blank is unknown, not zero.

| Coverage value | Definition |
| Stuffed CFT | Sum of included shipment-line milli-CFT for this container/vendor |
| Allocated CFT | Sum of every chain contribution in the group |
| Verified CFT | Sum of contributions whose chain passes current completion checks |
| Unallocated CFT | Stuffed total minus allocated total; negative values indicate over-allocation |
| Complete | Positive stuffed total, exact allocation, every allocated contribution verified, no unassigned shipments and no remaining legacy shares in a mixed inventory group |

Missing timber values remain visible as excluded rows in the legacy report. For inventory-backed final clearance they block completion. This preserves historical readability without granting clearance on an understated total.

The shipment table exposes PO/source, shipment invoice, item/sample code, quantity, CFT per unit and line CFT. It marks excluded rows explicitly and totals the included calculation. The report distinguishes total declaration from individual purchase/contribution quantities.

# 6. Chain report and navigation controls

The report header shows container, shipping vendor, vendor GST/PAN and chain Verified or Pending review. View All Documents opens the current evidence workspace; Back to Containers closes the report.

The summary shows declared timber, calculated stuffed timber, included/total shipment lines and verified/saved stages. A separate contribution card shows this chain's share and group-wide coverage. Mismatch warnings state the exact difference and the exact stuffed CFT required.

Update declaration amount opens a modal. Only the live stuffed total can be saved. The backend updates the common declared amount for sibling chains and invalidates relevant approvals; it preserves evidence/history. Update chain contribution opens another modal, constrained by coverage left after other chains. A contribution change clears this chain's verification. Active inventory reservations must first be released through the audited administrative workflow.

The progress navigator links to stage sections. Verified stages show reviewer/time; the first unverified stage is Pending review; later steps are Locked. Stage kinds not yet reached appear as upcoming placeholders. Each stage card shows metadata, its evidence gallery, missing required documents and an Edit Details action when current or already verified.

Verify and continue belongs to the current stage. The UI checks declaration/contribution feasibility before enabling it, but the backend remains authoritative for all required fields, documents, stage ordering and ledger rules.

Audit history displays newest events first, initially six. View Full Audit History expands the recorded chain history. Events show action, stage, actor and time, with changed fields, quantity before/after, replaced file names, invalidation reasons and counts of archived later stages where present.

# 7. Ordered chain stages, fields and evidence

The normal sequence is Sawmill -> Transport -> Receiver. If receiver GST and PAN both match the shipping vendor, the next stage is Declaration. Otherwise that receiver records an onward sale, followed by another Transport and Receiver. Repeated legs are supported; the system does not assume a fixed number of intermediaries.

[[STAGE_FLOW]]

## 7.1 Ara / Sawmill

Required verification fields are name, GST, PAN, permission_number, invoice_number, invoice_date, forest_latitude and forest_longitude. Workflow version 2 also requires sold_to, buyer_gst, buyer_pan and sold_cft. cutting_limit_cft is optional. Coordinates must be valid decimal numbers within latitude -90 to 90 and longitude -180 to 180.

Required evidence in version 2 is cutting_invoice (labelled Sawmill Sale Invoice), license, permission, forest_image, buyer_gst and buyer_pan. Forest image accepts actual PNG, JPEG or WebP bytes; a renamed PDF is not accepted. Sold CFT must be positive and cover at least this chain's contribution. A larger invoice is allowed and is not forced to equal the container total.

The optional cutting limit is a reference value, not production capacity. It does not automatically create a verified inventory root. The separate production-source workflow requires actual documented production evidence.

## 7.2 Transport

Required fields are transporter_name, truck_number, driver_license_number, ewaybill_number and billty_number. Transporter GST and truck_registration_number are optional. Required files are weight_slip, billty, driver_license and ewaybill. truck_registration evidence becomes mandatory when a registration number is entered.

The saved-details panel can select a transporter and then its associated saved truck and driver. It fills reusable identity fields, not transaction-specific e-way bill, billty, weight or sale values.

## 7.3 Receiver and onward sale

A modern receiver uses incoming_invoice_stage_id to reference the preceding seller across its transport leg. Name, GST and PAN are derived from that seller's buyer fields and cannot be independently changed in the receiver. Received CFT is entered for the receipt. To correct the incoming identity, edit and reverify the seller.

An intermediary receiver additionally enters onward invoice_number, invoice_date, sold_to, buyer_gst, buyer_pan and sold_cft, with invoice, buyer GST certificate and buyer PAN evidence. The final shipping-vendor receiver needs only identity and received_cft in its modern linked workflow; it reuses the preceding sale invoice and has no onward-sale uploads.

Legacy receiver records can carry invoice issuer fields issuer_name, issuer_gst and issuer_pan plus their own incoming invoice attachment. Editing upgrades them to the linked version-2 representation, preserving the old snapshot in history. The preceding seller must first have complete buyer and sold-quantity details and be reverified.

The stage UI correctly preserves the old statement that a received-CFT difference does not itself block stage verification. This is not a waiver of the inventory rules: a ledger receipt creates only its verified received quantity, shortages need explanation and receipt greater than supply cannot activate.

## 7.4 Declaration

Declaration has no structured editable business fields and requires a declaration attachment. The preceding path must be verified. The live container/vendor declaration must match stuffed CFT, and vendor assignments must be unambiguous.

When inventory applies, the declaration also requires a current reservation, verified spendable finished lots, global quantity feasibility, stuffing chronology and origin review. Inventory declarations use workflow version 3 and date-aware shipment/vendor signatures. Legacy declarations retain their existing representation and are not silently upgraded by migration.

## 7.5 Editor behavior and invalidation

Edit Details opens a drawer. Save step stores fields; file selection first saves fields then uploads immediately. Verify and continue saves the form and then requests manual verification. Upload status shows uploading, uploaded or failed, with Retry upload. Files are replaced one per stage purpose rather than silently added as competing current versions.

Editing a verified step or replacing its evidence asks for confirmation. The backend retains later steps in the history snapshot, removes them from the current ordered path and clears verification from the changed point. Reverification reconstructs the appropriate next step. Old files are retained rather than physically deleted.

Only known fields are accepted, values must be text/numbers and each is limited to 500 characters. Selecting Sold to vendor loads buyer identity from the server. Sold to other party allows a saved buyer or manual party identity. No client-submitted vendor identity override is authoritative.

# 8. Saved parties and controlled evidence reuse

Saved identities are generated automatically when complete stage details are saved. The directory stores sawmill, transporter, vehicle and buyer kinds. Shipping-vendor choices are read from the existing Vendor model rather than copied into a new vendor directory collection.

| Directory kind | Identity and reusable values | Evidence reuse |
| Sawmill | Normalized GST/PAN; name, permission number and optional cutting limit | Licence and permission, after validity confirmation |
| Transporter | GST when present, otherwise normalized name; transporter name/GST | No transaction files automatically reused |
| Vehicle | Transporter parent + truck + driver licence; truck/registration/licence numbers | Registration and driver licence, with matching identity |
| Buyer | Normalized buyer GST/PAN; sold_to and buyer identifiers | No sale quantity or transaction evidence automatically reused |
| Vendor choices | Existing active vendor identity | Buyer name/GST/PAN come from the selected vendor |

Searchable directory controls debounce requests by 200 ms. Saved truck and driver choices are filtered by transporter parent_key. Directory evidence IDs are stable hashes of evidence type/storage key. Users must confirm that saved evidence remains valid before linking it to another chain.

Reuse does not copy invoice numbers or quantities. Canonical invoice evidence has a separate explicit reuse action: when a matching upload already belongs to the registry, Link registered invoice evidence validates issuer, buyer, invoice identity and supported single-line sale quantity before linking the existing private object. Multi-line invoice usage is handled through inventory instead of fabricated chain-stage lines.

# 9. Inventory registry and batch detail UI

The Inventory section has Batch registry, Production source, Canonical invoice, Mixed sale, Processing conversion and Mix evidence workflow buttons. These are sections within the existing /eudr page, not separate standalone application routes.

The registry shows batch/invoice and stable ID, holder, documented CFT, committed CFT range, uncommitted documentary capacity range, material, lifecycle/verification/quantity status, origin review and potential-origin count, current lot document count and linked transaction count. View batch opens the selected lot's detail.

Search covers invoice number, batch identity and party. UI filters include lifecycle status (labelled Inventory verification state), incoming allocation mode, quantity result and container number. The API separately supports documentary verification, owner, vendor, party and material filters. These additional API filters are not all separate controls on the main registry screen.

Previous/Next controls paginate the registry, normally 25 per page. Draft and reserved outputs display Verification Pending instead of a spendable balance; terminal lots display no spendable range. Conflicting or too-complex networks expose review/error status. Individual ranges must not be added together.

| Detail tab | Content and controls |
| Overview | Holder/ID/invoice, documented material quantity, selected-lot range, shared holder/material range within this connected network, documentary/origin/quantity statuses and non-additivity warning |
| Upstream sources | Branching/merging SVG lineage and all potentially contributing plots/coordinates/permissions |
| Downstream usage | Connected transfers and commitments, quantities, allocation modes, status, container/output IDs; admin release controls for container commitments |
| Documents | Unique current connected-network evidence through the existing gallery and full viewer |
| Verification | Owning invoice/source/transfer/mix review panels, draft transfer editor, admin correction/reversal controls |
| History | Latest 50 audit events for the selected lot and its direct owning source/transfer/invoice |

The shared holder figure is constrained to the connected documentary network and matching material, not all purchases owned by that party anywhere in OMS. The document count on the list is the lot's current document list, while the Documents tab gathers its entire supporting network.

The DAG displays distinct party, source/receipt lot, transfer/transformation, mix and container nodes. Shared canonical records retain one identity. Ownership is visually distinct from input/output relationships. Batch nodes can be opened by click, Enter or Space. The graph scrolls horizontally when necessary; it is not a free-form drag editor or a legal-origin proof.

[[LINEAGE_SCREEN]]

# 10. Inventory creation forms and source selection

All forms select existing parties through vendor/sawmill/buyer directories. They search/select canonical documents or upload a new private file. Save documentary draft does not grant spendable supply. After creation a manual review panel is shown for the new record.

## 10.1 Production source form

Controls are Holder/seller, production date, documented production CFT, input material basis, unique evidence reference, forest plot, latitude, longitude and permission reference. The form provides production, licence, permission and forest image evidence pickers.

The current UI captures one origin row. The API accepts up to 100 origins, species, optional harvest_date and cutting_limit_cft. Source material is restricted by the backend to RAW or PROCESSING_INPUT even though the shared frontend material selector also lists FINISHED; selecting an unsupported source material is rejected rather than generating finished supply.

Production-reference retries with identical documentary data reuse the source. Conflicting data or reuse of already-owned production proof is blocked. New separately evidenced production is a new root, never an increase to an exhausted old root by selection alone.

## 10.2 Canonical invoice form

Controls are issuer, buyer, invoice date, total documented CFT, invoice number, optional no-GST identity clarification and one or more genuine lines. Each line has line ID, line CFT and material. Add genuine invoice line adds a distinct row. Lines must have unique IDs and sum exactly to the invoice total. Species is supported by the API/schema but has no input in this compact form.

For a valid GST issuer the permanent key is normalized issuer GST + Indian financial-year start year + normalized invoice number. The financial year starts 1 April. Formatting differences such as punctuation/case in invoice numbers do not create another identity. An issuer without GST requires a validated PAN identity and an explicit identity explanation; no fake GST is invented.

Same canonical identity and same data can be reused. Conflicting dates, quantities, parties, lines or evidence produce an identity conflict requiring correction. Registering the same invoice under another number merely because a file name changed cannot establish fresh entitlement.

## 10.3 Mixed sale / purchase form

Controls are seller, buyer, search/select registered sale invoice, line ID, invoice/transaction date, total sold CFT, input material, actual received CFT, receipt/availability date, shortage explanation, input contribution knowledge and supporting purchase lots. Selecting an invoice initializes its first line's ID/material and its canonical sale date; the backend validates the actual selected line and party match.

Sale documents, transport weight/billty/driver/e-way evidence and separate receipt evidence have pickers. Drafts may be collected before upstream input references are complete. They must be completed and verified origin-to-vendor before output is spendable.

The API also supports distinct fulfillment references under one line and dispatch_date. The current sale UI uses the default full fulfillment and does not expose a separate dispatch date or partial-fulfillment reference. Genuine partial fulfillments share the same line cap and cannot sum beyond it.

## 10.4 Source contribution selector

Select the holder, search source lots and choose one or more. Source pages show invoice/reference, documented quantity, status and material. Selected rows store participation as POSSIBLE or CONFIRMED independently from quantity knowledge.

| Mode | UI | Authoritative constraint |
| UNKNOWN | No per-source quantity fields | Each eligible contribution has zero lower bound; all contributions sum to the sale |
| EXACT | Exact CFT and bounds-evidence explanation per selected source | Every evidenced contribution is fixed |
| PARTIAL | Exact and/or min/max CFT, plus evidence explanation | Genuine known quantities/bounds are enforced; remaining shares stay unknown |

CONFIRMED participation alone does not fabricate a positive minimum. Check global quantity feasibility runs a read-only preview using selected sources and, when supplied, the proposed quantity/date. Edits invalidate the preview. The actual mutation always rebuilds and checks inside its transaction; a green preview is not a reservation.

## 10.5 Processing conversion form

Controls are holder, transaction date, processing input CFT, input material, unique operation reference, processed/finished output CFT, output availability date, output material, conversion/loss explanation, source contribution mode, inputs and transformation evidence.

This is a same-holder transformation, not an ownership sale. It consumes input once and records output/loss on a distinct material basis. Output must not exceed supported input for activation. No yield is automatically assumed. Raw purchases do not become eligible finished-container lots without a verified conversion.

## 10.6 Logical group or physical mix form

Controls are owner, unique mix reference, source lots, contribution mode, optional associated sale, Evidence confirms physical mixing and explanation/documents. A logical group creates no output lot. Physical mixing conservatively expands potential origin sets and holds affected approvals for review.

Quantified mix bounds require an associated sale with the same authoritative input constraints. The mix does not create a second quantity demand or a parallel balance. Creation with an already-used mix reference returns a conflict directing the user to reuse the existing record.

[[MOBILE_SCREEN]]

# 11. Manual inventory review, draft completion and administration

Every ReviewRecord panel identifies the resource, current revision, lifecycle and documentary/origin state. The reviewer enters a conclusion, confirms origin review if established, and confirms same-day ordering when relevant. Record manual verification submits the current revision; stale evidence cannot be approved silently.

| Resource | Activation requirements |
| Production source | Production/licence/permission/forest image evidence and complete valid plot/coordinate/permission records |
| Invoice | Invoice-purpose document, no conflicting proof owner, line caps consistent with fulfillments; legacy invoice integrity must have a recorded checksum |
| Transfer | Current verified invoice/line, verified input lots, own receipt evidence and weight/billty/driver/e-way evidence, supported dates, explained shortage |
| Transformation | Verified inputs, transformation-purpose evidence, supported input/output/loss and reviewed chronology |
| Physical mix | Manual evidence and origin conclusion; all potentially contributing origins remain in scope |
| Container commitment | Reserved through allocation UI; final commitment verification belongs to declaration clearance, not generic lot verification |

Origin review is separate: an evidence-verified record may still show REVIEW_REQUIRED for origin. A feasible equation does not automatically set origin VERIFIED.

Draft transfer completion appears in the batch Verification tab. It can update sold/input quantity, received/output quantity, receipt date, input mode/source references, own documents, transport/receipt files and discrepancy explanation. Save draft sources retains DRAFT. Save and reserve quantity counts the outgoing demand but leaves the output unspendable until verification. A held or completed record is not silently edited through the draft route.

Administrators see Audited correction / reversal panels. They enter a reason, current supporting evidence and corrected quantity/lines where applicable. Source corrections expose documented quantity; invoice corrections expose total and existing line quantities; transfer corrections expose input/sold and output/received quantities. API correction contracts additionally support certain dates, origin records and input constraints; these are not all UI fields.

Save correction and hold dependents preserves the previous snapshot, increments revision and holds the connected network's approvals without releasing historical demands. An infeasible reduction remains recorded as disputed evidence; it is not silently truncated to fit existing usage. Recovery requires fixing/reversing the conflict and re-reviewing from source forward.

Request controlled reversal requires an explicit reason and evidence for active historical use. Dependencies are returned for review; a source or incoming transfer cannot simply be cancelled while onward transactions exist. Leaf reversals and commitment releases may unwind an already infeasible held network in several steps; remaining infeasible records stay held. Mix reversal withdraws the physical-mixing claim with evidence and renewed origin review, not a quantity adjustment.

Old quantitative proof remains permanently owned by its invoice/source even after replacement or cancellation. It cannot be used with a new reference to recreate the old quantity. Shared licences and non-quantity evidence can still be reused legitimately.

# 12. Container allocation and final inventory-backed clearance

The chain report includes Documentary inventory allocation with required stuffed CFT, this contribution and inventory status. Select vendor lots expands its controls. The holder is fixed to the shipping vendor; only currently COMMITTED, VERIFIED FINISHED lots are offered. Multiple lots and partial shares are supported.

Choose allocation date, contribution mode, input lots and any evidenced source quantities. Confirm same-day receipt/allocation ordering if applicable. Reconcile and reserve contribution reserves exactly this chain's contribution, not a client-calculated replacement total. The backend also checks live sibling contributions and the global network.

For an untouched chain, inherited canonical lineage can replace the empty upstream stage scaffold with a container-specific declaration. An existing chain with saved fields, files or approvals is not silently erased. Its inherited network appears in the report and All Documents workspace without reuploading upstream evidence.

[[CONTAINER_FLOW]]

The allocation date cannot follow the earliest recorded stuffing date for that vendor's shipment rows. This is intentionally conservative because allocations are not mapped to individual shipment rows. Missing stuffing dates can remain during collection but block final clearance. Same-day supply requires manual ordering review; no time of day is invented.

Final clearance atomically checks current vendor identity, all active inputs/ancestors, documentary verification, all potential origin reviews, global quantity feasibility, missing timber/vendor assignments, exact declaration total, current contribution and stuffing dates. It commits the reservation and records a version-3 manual declaration with shipment/vendor signatures.

A new container reuses the same lots and movements; it cannot reset exhausted capacity. An active reservation competes with every other reservation even before final declaration. A later unverified declaration does not automatically return historical consumed quantities to availability.

Example: finished vendor lots V1=100 and V2=250 can support a 300 contribution using exact 100+200. V2 then has 50 documentary capacity if no other constraints compete. A raw 350 input converted with verified 50 loss to 300 finished output can support only 300 finished CFT, not an assumed 350.

# 13. Documents, previews and download behavior

Supported originals are PDF, PNG, JPG/JPEG, WebP, DOC/DOCX, XLS/XLSX, CSV and TXT. Upload middleware checks expected extension/MIME combinations and allows defined common MIME aliases. General uploads are in memory, one file per request, with default maximum 50 MiB configurable by GENERIC_UPLOAD_MAX_FILE_SIZE. Office conversion separately caps input and output at 50 MiB.

Each stage holds a current file per evidence purpose, including original name, private key, content type, size, SHA-256 and upload time. Upload computes the checksum. Chain duplicate protection checks both current and historical filenames/hashes, fetching old bytes if necessary when a historic hash is missing. This protection is distinct from explicit canonical reuse.

The canonical document picker searches the latest up-to-100 matching private files, selects IDs by checkbox and uploads with a specific purpose. Re-uploaded identical bytes return DOCUMENT_REUSE_AVAILABLE with the registered reference. Link existing file requires explicit confirmation. Identical bytes do not automatically prove that another claimed invoice identity is legitimate.

| UI feature | Behavior |
| Stage gallery | Lazy first-page/image thumbnail, document label/name/type and current review context |
| Preview | Opens the full viewer without editing or verifying evidence |
| Download | Requests an authorized short-lived original URL; does not download the generated preview instead |
| Retry preview | Retries failed thumbnail loading without losing the original file |
| All Documents | Total count, stage counts, stage filter tabs, filename/type/stage search and grouped evidence |
| Shared canonical group | Unique current network files grouped by owning source/invoice/transaction purpose |
| Previous/Next document | Navigates the current gallery's filtered document sequence; boundary controls disabled |
| Arrow Left/Right | Document navigation outside editable controls, without modifier keys |
| Zoom | 25%-300% in 25-point increments |
| Fit page / Fit width | Changes fitting mode and resets zoom to 100% |
| PDF pages | Previous/Next page, numeric page entry with Enter, continuous multipage scroll and lazy page rendering |
| Metadata sidebar | Saved stage details or canonical owner/evidence revisions, documentary and origin review |
| Close viewer/gallery | Closes native modal; focus/body-scroll behavior is managed by the existing dialog component |

Current gallery normalization excludes archived audit attachments. Canonical files deduplicate overlapping current stage hashes where available. All Documents stage-specific filters select stage attachments; shared inventory evidence remains visible in All Documents and the inventory batch gallery.

[[PAGE_BREAK]]

## Private file delivery and Office preview runtime

PDFs/images stream through authenticated private content endpoints with Range forwarding and Content-Range/Accept-Ranges support. Unsupported inline types use application/octet-stream. Responses use nosniff. The browser PDF runtime uses authenticated requests and a lazily loaded worker; images use temporary blob URLs.

Office originals convert to private PDFs. Conversion output is cached at a content-hash/versioned key. Same-object jobs coalesce; at most two different Office jobs are pending per process. Busy, timeout, corrupt/password-protected or unavailable-runtime errors remain visible with original download available.

Production private Office conversion requires Linux prlimit and bubblewrap isolation: no network namespace access, restricted mounts, dropped capabilities, cleared environment and resource limits. Macro execution and active content are disabled; DOCX/XLSX packages with VBA, macros, external links or embeddings are rejected. LibreOffice configuration supports LIBREOFFICE_BIN, LIBREOFFICE_BINARY, SOFFICE_BIN or SOFFICE_PATH.

The browser store shares PDF/image resources, evicts unused resources beyond its small cache and revokes object URLs/aborts work on disposal. SHA-256 supports identity and content-addressed preview caching; this is not a claim that every streamed download performs a new checksum comparison.

# 14. Unknown mixing and global reconciliation examples

Mixing is supported recursively at any ownership link. A transfer may draw from several lots and each lot may support several transfers. Inputs are not independent newly-created supplies when displayed through a logical mix. A buyer receipt and the seller's outgoing movement are two views of one transfer.

For A=500 and B=300 supporting an UNKNOWN 600 sale, constraints are xA+xB=600, 0<=xA<=500 and 0<=xB<=300. Feasible use is A 300-500 and B 100-300. Individual uncommitted ranges are each 0-200; their shared combined uncommitted quantity is exactly 200, not 400.

[[MIX_EXAMPLE]]

| Scenario | Expected implemented result |
| Original production 1000, outgoing A500+B300 | Sawmill committed 800; root uncommitted 200 |
| Party X sells unknown 600 using A+B | Quantity feasible; X combined remaining 200; buyer has one 600 receipt |
| A. X adds 200 using A only | Pass; hypothetical first split can be A300+B300; both input lots exhausted |
| B. Reset and add 200 using B only | Pass; hypothetical first split can be A500+B100; both exhausted |
| C. Reset and add 300 using A only | Fail; 900 demand cannot fit 800 documented inputs |
| D. After 600+200, add 1 using B | Block; no independently unspent balance is invented for B |
| E. Start another chain and request 100 | Block; canonical lot capacity is shared across chain references |
| F. Buyer uses its receipt for 250 then 350 | Pass against its 600; another 1 fails, with no repeated deduction from X |
| G. Root sells more than its remaining 200 | Block excess even when the next chain is new |
| H. New separately evidenced production | Separate verified root may support new transactions; original root is unchanged |

These hypothetical splits explain feasibility only. The application does not persist them as historical allocations, remove potential origins on their basis, assign FIFO/LIFO/proportional composition or claim physical segregation. All genuinely possible origin plots remain available to downstream review.

# 15. Constraint engine, numeric rules and concurrency

The quantity service builds one lower-bound circulation for all active operations in the connected component. Lot capacity edges supply each real root/receipt once. Input edges encode eligibility and genuine exact/bounded amounts. Every active operation has fixed total outgoing demand. A sink-to-source circulation and super-source/super-sink balancing reduce the problem to deterministic integer maximum flow with residual reverse edges.

Residual edges allow unknown splits to change simultaneously when a later competing claim is added. This is not first-selected-invoice subtraction. Integral capacities produce integral milli-CFT feasibility. Every ancestor transfer remains represented, while each downstream use consumes its immediate holder's receipt lot rather than consuming the ancestor movement again.

Component discovery follows indexed input/output lots, mix memberships and shared canonical invoice references. The last link joins partial fulfillments even if their upstream roots were initially separate. Invoice line totals therefore remain shared constraints after corrections.

Chronology compares verified availability with sale/allocation dates. Sale date must match the canonical invoice date. A later dispatch/receipt cannot justify use of supply unavailable at the historical sale. Cycles, self-sales, unrelated owners, wrong material bases, duplicate sources, unbacked receipts, future supply and invalid bounds fail closed.

All authoritative inventory amounts are safe nonnegative integers in thousandths of CFT. API decimals accept up to three places and are converted using BigInt before safe-integer validation. Output formatting preserves integer precision. The existing shipment line rounding convention remains unchanged.

Ranges minimize/maximize aggregate selected-lot use under the same complete constraints through bisection on a shared capacity edge. Outputs include feasibility/status, warnings, active transaction IDs, ranges and allocation_is_provenance:false. No arbitrary flow witness is persisted or returned as composition.

Inventory-changing operations require MongoDB transactions. The service writes the singleton global revision lock before authoritative reads, then takes the existing container/vendor EudrAllocation lock where needed. Competing formerly separate graphs cannot evade serialization by being merged concurrently. Unsupported transactions return a service error with no partial ledger mutation.

Transient conflicts have bounded retry/backoff: up to five transaction callbacks, a 15-second transaction deadline and a 10-second maximum commit time. Unique canonical identities, operation fingerprints and one commitment per chain make retries idempotent where supported. Obsolete creation payloads after correction return identity conflicts; they cannot overwrite a new revision.

| Limit | Current fail-closed bound |
| Connected lots / operations | 2000 / 4000 |
| Input edges / lineage depth | 16000 / 200 |
| Inputs per mutation / evidence IDs per group | 100 / 50 distinct |
| Invoice lines / origin records | 100 / 100 |
| Requested range groups | 50 |
| Residual edge inspections per reconciliation | 5 million |
| Registry quantity-filter candidates | 2000; narrow search when larger |
| API pagination | Default 25, maximum 100 rows; page capped at 100000 |

The conservative global lock favors integrity over write throughput. Graph/work limits are explicit service limits, not a reason to bypass reconciliation. Supporting operations remain drafts until valid evidence and constraints can be supplied.

# 16. Lifecycles, invalidation and audit semantics

[[LIFECYCLE]]

| Lifecycle | Quantity behavior | Supply eligibility |
| DRAFT | No active outgoing demand | No spendable output |
| RESERVED | Counts against competing demands | Transfer output not independently spendable |
| COMMITTED | Historical verified demand remains counted | Current verified source/receipt can support onward use |
| ON_HOLD | Historical demand remains active | Blocks new allocations and requires review |
| REJECTED / CANCELLED / SUPERSEDED | Excluded from active demand per explicit terminal state | Cannot supply new allocations |

Schemas support the terminal enums, but the current public correction/reversal API implements controlled cancellation rather than a separate unrestricted endpoint for every enum transition. No delete, force-stock or automatic balance-adjustment API is exposed.

Documentary verification status is PENDING, VERIFIED or ON_HOLD. Origin status is PENDING, REVIEW_REQUIRED, VERIFIED or ON_HOLD. Quantity result is derived by reconciliation, not stored as a legal clearance flag. Chain inventory status is LEGACY, RESERVED, COMMITTED or ON_HOLD.

Relevant evidence/quantity edits trigger global dependency holds. Changing one source can conservatively hold its whole connected network, including connected branches not individually proven to be affected; safety takes precedence over selective automatic reapproval. Held demands are never released merely because review becomes stale.

Local chain history records creation, field changes, file replacement, manual review, verification invalidation, superseded stages, amount changes and reuse. Central audit records invoice/source/transfer/mix creation, reuse, reservations, manual verification, correction, reversal/release, graph recalculation, conflicts, downstream holds and revision advancement. Before/after snapshots preserve changed evidence. There is no audit update/delete API.

Chain GET/list refresh can persist invalidation when current shipment/vendor signatures no longer match. This is different from document viewing: document content/preview/download endpoints do not change verification. Current declaration completion is always checked against live shipment/vendor data.

After a source correction, reverify its root and then actual transfers in topological order. Held container allocations must be re-reserved/reviewed before final declaration. A prior invoice review alone does not approve new receiving evidence or a new container quantity.

# 17. API reference and response contracts

All paths in the next table are relative to /eudr. Requests require existing authentication and EUDR roles. Most resources return {data: ...}; container lookup returns its own object with container, vendors, unassigned and chains. Errors include code, message and optional structured details. Inventory public serialization omits private storage keys.

| Method and path | Request / behavior |
| GET /container | query container; returns shipment/vendor groups, coverage and chains |
| GET / | optional container; latest 50 chain summaries |
| POST / | container, vendor_id, declared_cft, optional contribution_cft; creates chain transactionally |
| GET /:id | Chain detail, current vendor/shipment data, coverage, current stage and optional canonical network |
| PATCH /:id/declared | declared_cft matching live total; updates sibling declaration context |
| PATCH /:id/contribution | contribution_cft; capacity check and approval invalidation |
| GET /directory | kind, search, optional parent_key; saved party/vendor choices |
| GET /directory/:partyId | Saved party and reusable evidence metadata |
| PUT /:id/stages/:stageId | fields object with only supported stage keys |
| POST /:id/stages/:stageId/documents | multipart file and type; upload/replace current evidence |
| POST /:id/stages/:stageId/reuse-evidence | party_id, evidence_id, confirmed:true |
| POST /:id/stages/:stageId/reuse-invoice | invoice_id, confirmed:true; validated canonical single-line link |
| POST /:id/stages/:stageId/verify | Manual review, next-stage creation or final ledger-backed declaration |
| GET /:id/stages/:stageId/documents/:documentId/url | optional download=1; authorized temporary original URL |
| GET /:id/stages/:stageId/documents/:documentId/content | Private bytes, Range support |
| GET /:id/stages/:stageId/documents/:documentId/preview | Native PDF/image or converted Office PDF |

All inventory paths below are relative to /eudr/inventory. IDs returned by the batch registry identify lots; POST /batches returns a SourceBatch whose output_lot identifies its lot. Source verify/correct/cancel uses the source ID, not the lot ID. The UI performs this mapping.

| Method and path | Contract |
| GET /state | Registry/index/allocation/enforcement state |
| GET /batches | Paginated list; search, status, verification, owner, vendor, party, material, mode, container, quantity |
| POST /batches | owner, production_reference, quantity_cft, production_date, optional harvest/material/cutting limit, origins, documents |
| GET /batches/:id | Lot + network + recent relevant audit |
| GET /batches/:id/lineage | Connected lots/operations/mixes, invoices, sources, documents, potential origins and reconciliation |
| GET /batches/:id/commitments | Paginated matching commitment array |
| GET/POST /invoices | Paginated number search, or canonical registration/reuse |
| GET /invoices/:id | Canonical invoice and evidence revision |
| GET/POST /transfers | Paginated identity search, or sale/transformation draft |
| GET/PATCH /transfers/:id | Read or current draft edit with revision |
| POST /transfers/:id/reserve | Provisional active demand; legacy import restrictions apply |
| GET/POST /mixes | Paginated identity search, or logical/physical mix registration |
| GET /mixes/:id | Mix evidence, inputs and linked sale |
| POST /:resource/:id/verify | invoices/batches/transfers/mixes; revision, note, origins_reviewed, same_day_reviewed |
| PATCH /:resource/:id/correction | Admin invoices/batches/transfers; revision, reason, evidence and corrected values |
| POST /:resource/:id/cancel | Admin invoices/batches/transfers/mixes; revision, reason and required reversal evidence |
| POST /reconcile | 1-50 lot_ids, optional ranges and proposal; read-only preview |
| POST /commitments | chain, quantity_cft equal to chain contribution, date, mode, inputs, same_day_reviewed, optional inherited lineage |
| POST /commitments/:id/release | Admin revision, reason and completed-allocation reversal evidence |
| POST /migration/review-network | Admin atomic reviewed historical record order and all linked chain allocations |
| GET /conflicts | Paginated quantity-conflict/downstream-invalidation audit events |
| GET /audit | Paginated audit, optional entity filter |
| GET/POST /documents | Name search or multipart file+purpose upload |
| GET /documents/:id/url | Signed original/download URL |
| GET /documents/:id/content | Existing private content stream |
| GET /documents/:id/preview | Existing native/Office preview |

Batch/invoice/transfer/mix lists include pagination metadata. Audit, conflicts, document and batch-commitment endpoints return paged arrays under data without the same total/pages envelope. Callers should not assume every list has an identical response shape.

Party references are {kind:vendor|party,id}. Inputs contain lot, participation:POSSIBLE|CONFIRMED and optional exact_cft/min_cft/max_cft/evidence_note. Canonical invoice payloads contain issuer, buyer, number, date, total_cft, lines and documents. Sale payloads contain seller, buyer, invoice, line_id, fulfillment, sold_cft, received_cft, date/dispatch_date/receipt_date, mode, inputs and evidence groups. Transformation uses kind:TRANSFORMATION and idempotency_key instead of a sale invoice.

| Error class | Typical status / meaning |
| INVALID_QUANTITY / INVALID_REFERENCE / INVALID_LINES | 400; malformed or unsupported request |
| Authentication / FORBIDDEN | 401 / 403; missing login or insufficient role |
| NOT_FOUND | 404; record/file unavailable |
| INVOICE_IDENTITY_CONFLICT / DOCUMENT_IDENTITY_CONFLICT | 409; canonical ownership or factual evidence conflict |
| GLOBAL_QUANTITY_CONFLICT | 409; active commitments cannot fit simultaneously |
| CHRONOLOGY_CONFLICT / SAME_DAY_REVIEW | 409; dates or manual timing review unresolved |
| VERIFICATION_HOLD / ORIGIN_REVIEW_REQUIRED | 409; evidence eligibility is not current |
| STALE_REVISION / CONCURRENT_MODIFICATION | 409; reload current evidence and retry safely |
| DOWNSTREAM_REVERSAL_REQUIRED | 409; dependent transaction path must be resolved first |
| GRAPH_LIMIT / work budget | 413; supported reconciliation complexity exceeded |
| MONGODB_TRANSACTIONS_REQUIRED / rollout prerequisites | 503; no unsafe partial mutation is permitted |

The inline conflict component shows error code/reason, involved batch capacities and related transaction/date/container references when present. Other structured details are expandable. The conflict list is an administrative API, not a separate full-screen UI in the current implementation.

# 18. Data relationships and schema interpretation

[[DATA_MODEL]]

Canonical invoices cap quantities across genuine lines and fulfillments. A SourceBatch has one root Lot. A Transfer has one output Lot; that lot has one incoming_operation. A Mix references existing lots and optionally one authoritative output transfer, but creates no capacity. A Commitment references one Chain and its selected finished input lots. A chain may reference many canonical invoices and its one current commitment. Documents may be referenced from every owning record, with audit retaining prior snapshots.

The schema appendix is generated directly from Mongoose definitions at build time. It includes nested array/subdocument fields, types, required/default/enum/reference/index/validation options and all declared indexes for every EUDR model. Shared base fields are intentionally repeated per model so each collection can be understood independently. Mongoose-generated _id, __v and timestamps are included where defined.

Mixed fields such as stage.fields and identity snapshots are not arbitrary accepted request payloads. Stage services whitelist their allowed fields. Typical identity snapshots are name, gst, pan and a vendor/party reference; origin entries are plot, latitude, longitude, permission and species. Audit before/after/details intentionally preserve resource-specific revision snapshots.

The obsolete chain invoice_keys unique sparse index is conditional in the model definition and must be transitioned explicitly in the database. The canonical invoice identity index takes over global uniqueness; permanent proof indexes prevent replacement evidence from being reused for new entitlements. No automatic syncIndexes or broad index dropping is part of the migration workflow.

# 19. Existing OMS data consumed by EUDR

| Model / path | EUDR use |
| Vendor._id, name, gst, pan | Container grouping, shipping/buyer identity, party snapshots, vendor-signature invalidation |
| Vendor.deleted_at, is_active | Eligibility checks for selectable inventory parties/buyers |
| Item.code, timber_cft | Per-unit timber contained in shipped order items; missing values block inventory clearance |
| Order._id, order_id, item.item_code, vendor | Resolve shipment item and shipping vendor |
| Order.shipment[] | container, quantity, invoice_number, stuffing_date and shipment _id feed calculation/signatures |
| Sample._id, code, vendor, timber_cft | Sample shipment identity, holder and per-unit timber quantity |
| Sample.shipment[] | Same container/quantity/invoice/stuffing date calculation inputs |
| Authenticated users._id, name, role | Access decisions, verification reviewer and audit actor |

The EUDR module reads current timber quantities and shipments; it is not itself a general Item/Order/Sample editing screen. Missing values must be corrected in the relevant OMS source data or resolved through an authorized evidence-backed process. It never silently treats unknown timber content as zero.

No separate global party physical-inventory synchronization exists. Vendor raw purchases, processing inputs, verified loss and finished contained timber remain distinct documentary bases. The data model supports multiple source plots and species without claiming automatic geospatial or legal validation.

# 20. Migration, deployment and recovery

Rollout is controlled by EUDR_CANONICAL_INVOICES, EUDR_INVENTORY_REQUIRED and the persistent global state. registry_ready enables ledger writers after canonical preparation. invoice_index_transitioned records the guarded old-index transition. allocation_enabled controls container allocation. inventory_enforced persists once a verified source/receipt is active.

Prerequisites are a transaction-capable MongoDB replica set/cluster, required canonical/ledger indexes, existing private Wasabi configuration and existing preview runtime. No extra solver package was added. Migration commands require an explicit URI; they do not silently read MONGO_URI. Read-only modes disable automatic collection/index creation.

Recommended operator sequence: back up database and evidence; stop EUDR writers for ownership/index transition; deploy compatible schemas/code with allocations disabled; dry-run and resolve conflicts; apply; validate; enable canonical ownership on every writer; transition only the exact obsolete index; validate again; review selected historical networks; enable allocations; enable required inventory clearance; restart writers; run post-migration validation.

```text
node backend/scripts/eudrInventoryMigration.js --uri "<replica-set-uri>" --mode dry-run
node backend/scripts/eudrInventoryMigration.js --uri "<replica-set-uri>" --mode apply
node backend/scripts/eudrInventoryMigration.js --uri "<replica-set-uri>" --mode validate
# EUDR_CANONICAL_INVOICES=true on every writer and this process before transition:
node backend/scripts/eudrInventoryMigration.js --uri "<replica-set-uri>" --mode transition-index
node backend/scripts/eudrInventoryMigration.js --uri "<replica-set-uri>" --mode validate
# Explicit historical network review, then:
node backend/scripts/eudrInventoryMigration.js --uri "<replica-set-uri>" --mode enable-allocations
```

Discovery extracts canonical invoice identity, actual sold/received quantities, buyer/seller identity, incoming_invoice_stage_id links, stage state and existing private evidence references. Unambiguous transfers/lots are imported as DRAFT. No production root is inferred from a sale or cutting limit; unknown source splits remain unknown. Missing/ambiguous historical information creates a review record. Reruns are idempotent; historical approvals remain historical approvals.

The reviewed-network administrative API requires current evidence revisions in origin-to-vendor order and mapped contributions for every historical chain sharing the imported invoices. It verifies and reserves atomically. Final declaration approval remains a separate action. Legacy transfers cannot be directly activated to bypass historical usage mapping.

A legacy invoice without checksum cannot activate. Upload reviewed original bytes through canonical upload, which computes SHA-256 server-side, and perform an audited invoice evidence correction. Original objects and their proof ownership remain retained.

Recovery first disables new allocations without deleting history. Correct/re-review disputed evidence or reverse dependencies in reverse topological order. The old unique chain index can only be restored before legitimate cross-chain reuse/active entitlements make it incompatible.

```text
node backend/scripts/eudrInventoryMigration.js --uri "<replica-set-uri>" --mode disable-allocations
node backend/scripts/eudrInventoryMigration.js --uri "<replica-set-uri>" --mode rollback-index
```

rollback-index refuses active commitments, active documentary entitlements or duplicate cross-chain invoice keys. It restores only the exact old index, retains ledger/audit/evidence collections and resets rollout state only when safe. After legitimate reuse, forward recovery is required. No destructive production migration was run during the implementation or this documentation task.

# 21. Testing evidence, limitations and maintenance

Previously executed repository verification on 13 October 2026: backend 686 passing tests with one existing conditional HEIC skip (687 total); frontend 50 passing tests; isolated inventory MongoDB/API integration 20 passing tests including its parent; existing allocation integration passed with 12 competing allocations; existing and new browser suites passed; production Vite build passed; real DOC/DOCX/XLS/XLSX/CSV/TXT conversion fixtures passed on Windows. These are recorded implementation results, not new production acceptance tests performed by generating this PDF.

The solver suite covers mandatory A-H, exact/partial/unknown inputs, shared and nested paths, ownership, chronology/cycles, reservations/holds, integer boundaries, 200 deterministic randomized networks against exhaustive feasibility and 80 bounded-range extrema cases. Integration covers actual isolated MongoDB transactions, competing sales/containers/mixes, retries/idempotency/rollback, canonical conflicts, shortages/conversion, reduced quantities/holds/recovery, proof ownership, stepwise reversals, migration/import/index transition, role checks and reusable files.

Browser checks cover chain forms, PDF/image rendering, multipage controls, filtered navigation, original downloads, responsive layout, inventory search/ranges/DAG, unknown-input selection, conflict context, canonical preview and vendor-lot allocation. They use intercepted fixture APIs, not production Wasabi or live business records.

```text
# backend working directory
npm test
npm run test:eudr-inventory
npm run test:eudr-inventory:integration
node tests/eudrAllocation.integration.js /path/to/mongod
node tests/eudrOffice.integration.js
node tests/eudrChain.browser.js
node tests/eudrInventory.browser.js
# client/OMS working directory
npm test
npm run build
```

Set EUDR_TEST_MONGOD to the test mongod executable before the inventory integration command. Tests start their own loopback-only temporary replica set, never use MONGO_URI and validate the spawned process. Build before browser scripts. The HEIC skip requires QC_HEIC_FIXTURE_PATH and is unrelated to EUDR inventory.

## Explicit current boundaries

There is no automatic physical stock confirmation, OCR extraction, external GST lookup, EUDR legal certification, forest-origin proof or manufacturing-yield assumption. Human review remains required for physical mixing, sources, same-day ordering, losses and legacy ambiguity.

The UI is intentionally a compact implementation: single-origin production entry, no separate full invoice/transfer resource pages, no standalone audit/conflict dashboard, no UI migration/index buttons, no unrestricted adjustments, no automatic multi-line-to-linear-stage conversion, and no separate UI controls for all API-only date/correction/fulfillment options. These are boundaries of the current interface, not missing quantities silently filled by code.

The global lock serializes unrelated writes and the solver fails closed beyond explicit bounds. Date-only ordering and the earliest-stuffing rule are conservative. Quantity-filter evaluation must be narrowed for large registries. Audit previews are paged; batch history shows only its latest direct events, not an unlimited embedded global audit.

Production deployment/migration, live Wasabi round trips and the Linux production Office sandbox were not verified by the local implementation test run. Trusted local Windows Office fixtures tested conversion correctness, not Linux isolation. Production runtime configuration must still be validated by the operator.

Inventory intentionally retains potentially orphaned uploads after ambiguous metadata failures instead of deleting a possibly shared object. Cleanup requires independent reconciliation against current and historical references; no evidence deletion workflow is implemented here.

This document is a code snapshot. Rebuild it after schema, API, verification or UI changes. The generated appendix provides exact structural fields; service/UI chapters document the additional request validation and business invariants that schemas alone cannot express.

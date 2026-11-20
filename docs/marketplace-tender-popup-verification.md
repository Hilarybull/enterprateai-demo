# Tender recommendations and evaluation follow-up — 20 November 2026

Dashboard recommendations show two previews per available category. “See more” opens a modal containing all ranked matches, ten per page, with Previous/Next controls on all screen sizes and page numbers on larger screens. Counts cover the complete matching set. Awards are omitted when unavailable. The authenticated recommendations endpoint accepts `stage=open|award`, `page` and `page_size`; it repeats the existing workspace access check before reading capabilities. No schema migration is needed.

Public tender filters use a shorter three-field primary row, with SME suitability and other options in More filters. The count sits at the bottom. Listing cards no longer display the “SME suitable” badge. Tender evaluation occupies the detail page's side column and opens its results in a modal.

Evaluations already persist under the workspace's `tender_evaluations` record. A new authenticated read endpoint, `GET /public-tenders/{listing_id}/evaluation?workspace_id=...`, reopens saved results without model generation. It compares the tender/business snapshot and prompt version to flag an older assessment. Viewing an older result does not regenerate it; Update evaluation is explicit. Notice/workspace changes dismiss old UI results and ignore late responses.

The earlier evaluator required a nonempty comparison `findings` list. A live configured-provider check using a public grounds-maintenance tender fixture and no business profile returned six valid evidence-linked overview sections and zero findings. The new validator accepts that useful summary. It still rejects empty analyses and removes overview sections with invalid citations. Summary-only results are labelled “Tender summary”, not a positive business-fit verdict. Practical next steps can be returned independently of business comparisons. Provider failures log the exception type without private source text or response bodies.

Verification: 33 backend tests and 18 frontend component/dashboard checks passed. The frontend production build passed with existing CSS minification and bundle-size warnings. Live fixture generation succeeded with the configured Claude provider; no real workspace was read or written by that check. The responsive Chromium suite is supplied for 390, 768 and 1440 px. Local attempts timed out during page/module startup, including the isolated component fixture; no responsive browser pass is claimed. This remains a verification gap. Component checks cover popup paging, closing, workspace changes, retry and reopening saved evaluations without generating again.

Rollback: revert these code changes; stored evaluations remain in the existing workspace record and do not require a data migration. No deployment or push. Real signup email verification, connected buyer-to-contract and full payment lifecycle verification remain outstanding.

## Demo staging promotion checks

The scoped demo checkout passed 78 backend regression checks, 19 frontend checks and the production build before the authorised push to `Hilarybull/enterprateai-demo`, branch `staging`. Clarity tracking is absent. Unrelated unfinished Agent changes were excluded. Responsive browser verification retains the startup blocker recorded above.

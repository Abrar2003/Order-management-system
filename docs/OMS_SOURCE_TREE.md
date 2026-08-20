# OMS Source Tree

This is a complete source/configuration/documentation tree for the OMS working repository. It is a structural index for humans and AI agents, not a runtime build artifact.

Included: application source, tests, deployment files, checked-in documentation, static frontend assets, and repository configuration that is not ignored.
Excluded: `.git/`, dependency folders, build/coverage output, the local `.tmp/` workspace, ignored secrets such as `.env*`, and runtime log/data output.

```text
oms/
|-- .github/
|   `-- workflows/
|       |-- ci.yml
|       `-- deploy-vps.yml
|-- .vscode/
|   `-- settings.json
|-- backend/
|   |-- config/
|   |   |-- buildInfo.js
|   |   |-- connectDB.js
|   |   |-- loadEnv.js
|   |   |-- multer.config.js
|   |   |-- qcImageUpload.config.js
|   |   `-- redis.js
|   |-- controllers/
|   |   |-- workflow/
|   |   |   |-- _utils.js
|   |   |   |-- batch.controller.js
|   |   |   |-- department.controller.js
|   |   |   |-- task.controller.js
|   |   |   `-- taskType.controller.js
|   |   |-- auth.controller.js
|   |   |-- brand.controller.js
|   |   |-- complaint.controller.js
|   |   |-- emailLogs.controller.js
|   |   |-- finish.controller.js
|   |   |-- inspector.controller.js
|   |   |-- item.controller.js
|   |   |-- jobs.controller.js
|   |   |-- notification.controller.js
|   |   |-- omsChat.controller.js
|   |   |-- order.controller.js
|   |   |-- pdf.controller.js
|   |   |-- permission.controller.js
|   |   |-- product.controller.js
|   |   |-- productTypeTemplate.controller.js
|   |   |-- qc.controller.js
|   |   |-- qcImageDirectUpload.controller.js
|   |   |-- reports.controller.js
|   |   |-- sample.controller.js
|   |   |-- sampleWorkflow.controller.js
|   |   |-- security.controller.js
|   |   |-- user.controller.js
|   |   `-- vendor.controller.js
|   |-- docs/
|   |   `-- qc-direct-upload-and-nightly-processing.md
|   |-- helpers/
|   |   |-- barcodeFormat.js
|   |   |-- boxMeasurement.js
|   |   |-- claimPercentage.js
|   |   |-- commonInspectionErrors.js
|   |   |-- dateOnly.js
|   |   |-- dateparsser.js
|   |   |-- fileCleanup.js
|   |   |-- finalPisCheck.js
|   |   |-- formDrafts.js
|   |   |-- inspectionSizeSnapshot.js
|   |   |-- itemLegacySizeCleanup.js
|   |   |-- itemUpdateAudit.js
|   |   |-- itemUpdateHistory.js
|   |   |-- labelExemptUsers.js
|   |   |-- manualOrderValidation.js
|   |   |-- masterSizeRemarks.js
|   |   |-- measurementMismatchRules.js
|   |   |-- mongoConnectionDiagnostics.js
|   |   |-- orderStatus.js
|   |   |-- permissions.js
|   |   |-- pisExcelParser.js
|   |   |-- pisInspectionMasterComparison.js
|   |   |-- productDatabase.js
|   |   |-- productTypeTemplates.js
|   |   |-- qcUpdateWindow.js
|   |   |-- rectifyImporterHelper.js
|   |   |-- sizeDimensionFormatter.js
|   |   |-- transactionalController.js
|   |   |-- userRole.js
|   |   |-- vendorRef.js
|   |   |-- workbookReport.js
|   |   `-- workflow.js
|   |-- knowledge/
|   |   |-- omsKnowledgeBase.catalog.js
|   |   `-- omsKnowledgeBase.schema.js
|   |-- middlewares/
|   |   |-- auth.middleware.js
|   |   |-- authorize.middleware.js
|   |   |-- cache.middleware.js
|   |   |-- omsChatRateLimit.middleware.js
|   |   |-- parseAndSyncPisUpload.middleware.js
|   |   |-- permission.middleware.js
|   |   |-- rateLimit.middleware.js
|   |   `-- securityActivityLogger.js
|   |-- models/
|   |   |-- workflow/
|   |   |   |-- Batch.model.js
|   |   |   |-- Comment.model.js
|   |   |   |-- Department.model.js
|   |   |   |-- index.js
|   |   |   |-- shared.js
|   |   |   |-- Task.model.js
|   |   |   |-- TaskAssignment.model.js
|   |   |   |-- TaskStatusHistory.model.js
|   |   |   `-- TaskType.model.js
|   |   |-- authSession.model.js
|   |   |-- brand.model.js
|   |   |-- complaint.model.js
|   |   |-- complaintCategory.model.js
|   |   |-- emailLogs.model.js
|   |   |-- finish.model.js
|   |   |-- inspection.model.js
|   |   |-- inspector.model.js
|   |   |-- item.model.js
|   |   |-- notification.model.js
|   |   |-- omsChatConversation.model.js
|   |   |-- omsChatRateBucket.model.js
|   |   |-- order.model.js
|   |   |-- orderEditLog.model.js
|   |   |-- pisUpdateLog.model.js
|   |   |-- productTypeTemplate.model.js
|   |   |-- qc.model.js
|   |   |-- qcEditLog.model.js
|   |   |-- rolePermission.model.js
|   |   |-- sample.model.js
|   |   |-- sampleWorkflow.model.js
|   |   |-- securityActivityLog.model.js
|   |   |-- securityAlert.model.js
|   |   |-- uploadLog.model.js
|   |   |-- user.model.js
|   |   |-- userSecurityBaseline.model.js
|   |   `-- vendor.model.js
|   |-- queues/
|   |   |-- index.js
|   |   `-- jobNames.js
|   |-- realtime/
|   |   `-- workflowSocket.js
|   |-- routers/
|   |   |-- auth.routes.js
|   |   |-- brand.route.js
|   |   |-- complaints.routes.js
|   |   |-- emailLogs.routes.js
|   |   |-- finish.routes.js
|   |   |-- google.routes.js
|   |   |-- inspector.routes.js
|   |   |-- items.routes.js
|   |   |-- jobs.routes.js
|   |   |-- notifications.routes.js
|   |   |-- omsChat.routes.js
|   |   |-- orders.routes.js
|   |   |-- permissions.routes.js
|   |   |-- productTypeTemplates.routes.js
|   |   |-- qc.routes.js
|   |   |-- qcImages.routes.js
|   |   |-- reports.routes.js
|   |   |-- samples.routes.js
|   |   |-- sampleWorkflow.routes.js
|   |   |-- security.routes.js
|   |   |-- user.routes.js
|   |   |-- vendor.routes.js
|   |   `-- workflow.routes.js
|   |-- scripts/
|   |   |-- output/
|   |   |   |-- pis-pdf-example/
|   |   |   |   `-- 96568-pis.pdf
|   |   |   |-- pis-pdf-example-full/
|   |   |   |   `-- 96568-pis.pdf
|   |   |   |-- ~$bb-shipping-marks-dry-run.xlsx
|   |   |   |-- bb-shipping-marks-dry-run.xlsx
|   |   |   |-- bb-shipping-marks-dry-run1.xlsx
|   |   |   `-- is-shipping-marks-dry-run.xlsx
|   |   |-- addCabinetSubProductTypeTemplate.js
|   |   |-- backfill-qc-thumbnails.js
|   |   |-- backfill-vendor-objects.js
|   |   |-- backfillInspectionSizeSnapshots.js
|   |   |-- backfillItemKdFromLegacyFields.js
|   |   |-- backfillQcInspectorAssignments.js
|   |   |-- backfillSingleMasterSizeRemarks.js
|   |   |-- backfillTotalPoCbm.js
|   |   |-- backfillWorkflowReworkBeforeApproval.js
|   |   |-- check-env.js
|   |   |-- checkCalender.js
|   |   |-- cleanupLegacyItemSizeFields.js
|   |   |-- createByBooDbComparisonSheet.js
|   |   |-- deleteDups.js
|   |   |-- exportPisPdfExample.js
|   |   |-- importRectifyItems.js
|   |   |-- migrateInspectionBarcodeFieldsToString.js
|   |   |-- migrateItemQcBarcodeFieldsToString.js
|   |   |-- PDFtoSheet.js
|   |   |-- PIS_extractor.js
|   |   |-- README-qc-thumbnail-backfill.md
|   |   |-- script.js
|   |   |-- seedProductTypeTemplates.js
|   |   |-- seedRolePermissions.js
|   |   |-- seedWorkflowTaskTypes.js
|   |   |-- setWasabiCors.js
|   |   |-- sync-item-country-from-vendors.js
|   |   |-- syncScriptDbToMongo.js
|   |   |-- syncItemsInspectedDataFromLatestInspections.js
|   |   |-- syncPisWorkbooks.js
|   |   |-- updatePISbarcode.js
|   |   |-- UpdateSize.js
|   |   |-- uploadPisFolderViaApi.js
|   |   |-- uploadShippingMarksFolderViaApi.js
|   |   |-- validate-vendor-objects.js
|   |   |-- validateQcHeicSharp.js
|   |   `-- verifyBuildInfo.js
|   |-- services/
|   |   |-- workflow/
|   |   |   |-- workflowBatchAggregationService.js
|   |   |   |-- workflowBatchService.js
|   |   |   |-- workflowPermissionService.js
|   |   |   |-- workflowRealtimeService.js
|   |   |   |-- workflowStatusService.js
|   |   |   `-- workflowTaskGenerationService.js
|   |   |-- authToken.service.js
|   |   |-- cache.service.js
|   |   |-- cacheInvalidation.service.js
|   |   |-- convertXlsxToPDF.service.js
|   |   |-- gcalSync.js
|   |   |-- imageOptimization.service.js
|   |   |-- imageThumbnailService.js
|   |   |-- inspectionItemSync.service.js
|   |   |-- itemSync.js
|   |   |-- monthlyShipmentsReport.service.js
|   |   |-- notificationService.js
|   |   |-- omsAiProvider.service.js
|   |   |-- omsCapabilityExecution.service.js
|   |   |-- omsChat.service.js
|   |   |-- omsChatCatalog.service.js
|   |   |-- omsChatLogger.service.js
|   |   |-- omsChatQuery.service.js
|   |   |-- omsForecast.service.js
|   |   |-- omsKnowledgeBase.service.js
|   |   |-- orderCbm.service.js
|   |   |-- packedGoods.service.js
|   |   |-- pdfPrintStyles.js
|   |   |-- pdfRectifyParser.service.js
|   |   |-- pdfRenderer.js
|   |   |-- permission.service.js
|   |   |-- qcBarcodeScan.service.js
|   |   |-- qcImageDirectUpload.service.js
|   |   |-- qcImageDownload.service.js
|   |   |-- qcImageProcessing.service.js
|   |   |-- qcImageProcessingWindow.js
|   |   |-- qcImageThumbnail.service.js
|   |   |-- qcImageUpload.service.js
|   |   |-- qcInspectionImageOwnership.service.js
|   |   |-- securityBaselineCron.js
|   |   |-- securityMonitoringService.js
|   |   |-- shipmentCbmAllocation.service.js
|   |   |-- storageDeletionAudit.service.js
|   |   |-- userDataAccess.service.js
|   |   |-- validInspectionHistory.service.js
|   |   `-- wasabiStorage.service.js
|   |-- tests/
|   |   |-- archivedOrders.test.js
|   |   |-- buildInfo.test.js
|   |   |-- claimPercentage.test.js
|   |   |-- commonInspectionErrors.test.js
|   |   |-- delayedPoReport.test.js
|   |   |-- finishImageRequirement.test.js
|   |   |-- imageThumbnailService.test.js
|   |   |-- individualMasterBoxMode.test.js
|   |   |-- inspectedItemsReport.test.js
|   |   |-- inspectorApprovedGoodsCbm.test.js
|   |   |-- inspectorLabelAllocation.test.js
|   |   |-- itemBarcodeAlias.test.js
|   |   |-- itemCountryFilter.test.js
|   |   |-- itemDetailsFileDelete.test.js
|   |   |-- itemExportPoStatus.test.js
|   |   |-- itemVendorCountry.test.js
|   |   |-- manualOrderController.test.js
|   |   |-- manualOrderValidation.test.js
|   |   |-- masterSizeRemarks.test.js
|   |   |-- monthlyShipmentsReport.test.js
|   |   |-- omsAiProvider.test.js
|   |   |-- omsCapabilityExecution.test.js
|   |   |-- omsChat.test.js
|   |   |-- omsForecast.test.js
|   |   |-- omsKnowledgeBase.test.js
|   |   |-- orderItemFilterStatus.test.js
|   |   |-- pdfArchitecture.test.js
|   |   |-- pdfPrintStyles.test.js
|   |   |-- pdfRenderer.test.js
|   |   |-- pisBarcodeExemption.test.js
|   |   |-- pisExcelParser.test.js
|   |   |-- productDatabaseRemarks.test.js
|   |   |-- qcImageDirectUploadDuplicates.test.js
|   |   |-- qcImageDownload.test.js
|   |   |-- qcImageProcessingService.test.js
|   |   |-- qcImageProcessingWindow.test.js
|   |   |-- qcInspectorAssignmentSync.test.js
|   |   |-- qcPisBarcode.test.js
|   |   |-- qcPreviousPoImageHistory.test.js
|   |   |-- qcReportMismatchSelection.test.js
|   |   |-- qcUpdateWindow.test.js
|   |   |-- queueJobIds.test.js
|   |   |-- rectifyImporter.test.js
|   |   |-- sampleConversion.test.js
|   |   |-- sampleRemarks.test.js
|   |   |-- sizeDimensionFormatter.test.js
|   |   |-- storageDeletionAudit.test.js
|   |   |-- syncScriptDbToMongo.test.js
|   |   |-- transactionalController.test.js
|   |   |-- uploadPisFolderViaApi.test.js
|   |   |-- uploadShippingMarksFolderViaApi.test.js
|   |   |-- validInspectionHistory.test.js
|   |   |-- vendorSummary.test.js
|   |   `-- workflowTaskSourceFilter.test.js
|   |-- uploads/
|   |   `-- .gitkeep
|   |-- workers/
|   |   `-- index.js
|   |-- .env.example
|   |-- .gitignore
|   |-- check_shipments.js
|   |-- check.js
|   |-- debug_rows.js
|   |-- debug_summary.js
|   |-- index.js
|   |-- package-lock.json
|   |-- package.json
|   |-- qcImageWorker.js
|   `-- worker.js
|-- client/
|   `-- OMS/
|       |-- public/
|       |   |-- workflow-icons/
|       |   |   |-- delete.png
|       |   |   |-- info.png
|       |   |   `-- rework.png
|       |   |-- archive.png
|       |   |-- chat.png
|       |   |-- delete.png
|       |   |-- dutch_interior.png
|       |   |-- Giga.png
|       |   |-- license-234157714-4519497.pdf
|       |   |-- logo.png
|       |   `-- vite.svg
|       |-- src/
|       |   |-- api/
|       |   |   |-- axios.js
|       |   |   `-- workflowApi.js
|       |   |-- auth/
|       |   |   |-- auth.service.js
|       |   |   |-- auth.utils.js
|       |   |   |-- PermissionContext.jsx
|       |   |   `-- permissions.js
|       |   |-- components/
|       |   |   |-- complaints/
|       |   |   |   |-- AddCommentModal.jsx
|       |   |   |   |-- AddComplaintModal.jsx
|       |   |   |   |-- ComplaintAccordionDetails.jsx
|       |   |   |   |-- complaintConstants.js
|       |   |   |   |-- ComplaintFilesDropdown.jsx
|       |   |   |   |-- EditComplaintModal.jsx
|       |   |   |   |-- QcItemComplaintsSection.jsx
|       |   |   |   `-- UploadComplaintFilesModal.jsx
|       |   |   |-- reports/
|       |   |   |   |-- InspectorCard.jsx
|       |   |   |   `-- InspectorReportCharts.jsx
|       |   |   |-- samples/
|       |   |   |   |-- ConvertToItemModal.jsx
|       |   |   |   `-- SampleCreateModal.jsx
|       |   |   |-- workflow/
|       |   |   |   |-- WorkflowBatchBulkActionsModal.jsx
|       |   |   |   |-- WorkflowBatchCreateModal.jsx
|       |   |   |   |-- WorkflowDepartmentEditorModal.jsx
|       |   |   |   |-- WorkflowTaskCreateModal.jsx
|       |   |   |   |-- WorkflowTaskDetailModal.jsx
|       |   |   |   |-- workflowTaskProgress.js
|       |   |   |   |-- WorkflowTasksPanel.jsx
|       |   |   |   |-- WorkflowTaskStageBar.jsx
|       |   |   |   `-- WorkflowTaskTypeEditorModal.jsx
|       |   |   |-- AdminRequiredFieldsWarning.jsx
|       |   |   |-- AlignQcModal.jsx
|       |   |   |-- AllocateLabelsModal.jsx
|       |   |   |-- ArchiveOrderModal.jsx
|       |   |   |-- BulkRevisedEtdModal.jsx
|       |   |   |-- ChangePasswordModal.jsx
|       |   |   |-- CheckLabelsModal.jsx
|       |   |   |-- CreateItemModal.jsx
|       |   |   |-- EditCompleteOrderModal.jsx
|       |   |   |-- EditInspectionRecordsModal.jsx
|       |   |   |-- EditItemModal.jsx
|       |   |   |-- EditOrderModal.jsx
|       |   |   |-- EditPisModal.jsx
|       |   |   |-- EditSampleModal.jsx
|       |   |   |-- EmailLogsModal.jsx
|       |   |   |-- ErrorBoundary.jsx
|       |   |   |-- FilePreviewModal.jsx
|       |   |   |-- GoodsNotReadyModal.jsx
|       |   |   |-- HoverPortal.jsx
|       |   |   |-- ItemOrderPresenceTooltip.jsx
|       |   |   |-- MeasuredSizeDisplayTable.jsx
|       |   |   |-- MeasuredSizeSection.jsx
|       |   |   |-- Navbar.jsx
|       |   |   |-- OrderEtdWithHistory.jsx
|       |   |   |-- OrderExportModal.jsx
|       |   |   |-- OrderQuantityWithHistory.jsx
|       |   |   |-- PdfViewerModal.jsx
|       |   |   |-- PreviousOrderCheckModal.jsx
|       |   |   |-- ProductImageThumbnail.jsx
|       |   |   |-- ProductTypeDynamicForm.jsx
|       |   |   |-- RectifyPdfModal.jsx
|       |   |   |-- RejectAllModal.jsx
|       |   |   |-- ReportInfoBanner.jsx
|       |   |   |-- RevisedEtdModal.jsx
|       |   |   |-- SampleModal.jsx
|       |   |   |-- ShippingModal.jsx
|       |   |   |-- SortHeaderButton.jsx
|       |   |   |-- Tooltip.jsx
|       |   |   |-- TransferInspectionModal.jsx
|       |   |   |-- TransferQcRequestModal.jsx
|       |   |   |-- UpcomingEtdExportModal.jsx
|       |   |   |-- UpdateQcModal.jsx
|       |   |   |-- UploadFinishModal.jsx
|       |   |   `-- UploadOrdersModal.jsx
|       |   |-- constants/
|       |   |   |-- countries.js
|       |   |   |-- countryOfOrigin.js
|       |   |   `-- itemFiles.js
|       |   |-- hooks/
|       |   |   |-- useBrandOptions.js
|       |   |   |-- useBulkQcImageUpload.js
|       |   |   |-- useFormDraft.js
|       |   |   |-- useMobileKeyboardHandler.js
|       |   |   |-- useRememberSearchParams.js
|       |   |   |-- useShippingInspectors.js
|       |   |   `-- useWorkflowRealtime.js
|       |   |-- notifications/
|       |   |   |-- notificationApi.js
|       |   |   |-- NotificationBell.jsx
|       |   |   |-- notificationCard.js
|       |   |   |-- NotificationDock.jsx
|       |   |   |-- NotificationPopupModal.jsx
|       |   |   |-- notificationSocket.js
|       |   |   |-- NotificationToast.jsx
|       |   |   `-- useNotifications.js
|       |   |-- pages/
|       |   |   |-- ArchivedOrders.jsx
|       |   |   |-- BrandScopeChoice.jsx
|       |   |   |-- CommonErrorsReport.jsx
|       |   |   |-- Complaints.jsx
|       |   |   |-- Container.jsx
|       |   |   |-- Containers.jsx
|       |   |   |-- CreateVendor.jsx
|       |   |   |-- DailyReport.jsx
|       |   |   |-- DailySummary.jsx
|       |   |   |-- DelayedPoReports.jsx
|       |   |   |-- EmailLogs.jsx
|       |   |   |-- FinalPISCheck.jsx
|       |   |   |-- Finishes.jsx
|       |   |   |-- Home.jsx
|       |   |   |-- InspectedItemsReport.jsx
|       |   |   |-- inspection_report.jsx
|       |   |   |-- InspectorReports.jsx
|       |   |   |-- ItemDatabase.jsx
|       |   |   |-- ItemDetails.jsx
|       |   |   |-- ItemFilesPage.jsx
|       |   |   |-- ItemMasters.jsx
|       |   |   |-- ItemOrdersHistory.jsx
|       |   |   |-- Items.jsx
|       |   |   |-- MonthlyShipmentsReport.jsx
|       |   |   |-- OmsAssistant.jsx
|       |   |   |-- OpenOrders.jsx
|       |   |   |-- OrderEditLogs.jsx
|       |   |   |-- Orders.jsx
|       |   |   |-- OrdersByBrand.jsx
|       |   |   |-- PackedGoods.jsx
|       |   |   |-- PendingPoReport.jsx
|       |   |   |-- PermissionManagement.jsx
|       |   |   |-- PIS.jsx
|       |   |   |-- PISDiffs.jsx
|       |   |   |-- PisInspectionMasterComparison.jsx
|       |   |   |-- PisUpdateLogs.jsx
|       |   |   |-- PoStatusReport.jsx
|       |   |   |-- ProductAnalytics.jsx
|       |   |   |-- ProductDatabase.jsx
|       |   |   |-- ProductDatabaseDetails.jsx
|       |   |   |-- ProductTypeTemplates.jsx
|       |   |   |-- QcDetails.jsx
|       |   |   |-- QcPage.jsx
|       |   |   |-- QcReportMismatch.jsx
|       |   |   |-- Samples.jsx
|       |   |   |-- SampleWorkflow.jsx
|       |   |   |-- SecurityDashboard.jsx
|       |   |   |-- Shipments.jsx
|       |   |   |-- ShippedSamples.jsx
|       |   |   |-- ShippingDelayReports.jsx
|       |   |   |-- ShippingPending.jsx
|       |   |   |-- Signin.jsx
|       |   |   |-- Signup.jsx
|       |   |   |-- UpcomingEtdReports.jsx
|       |   |   |-- UploadLogs.jsx
|       |   |   |-- VendorDetails.jsx
|       |   |   |-- VendorReports.jsx
|       |   |   |-- VendorWiseQAReport.jsx
|       |   |   |-- WeeklySummary.jsx
|       |   |   |-- WorkflowBatchDetail.jsx
|       |   |   |-- WorkflowBatches.jsx
|       |   |   |-- WorkflowDashboard.jsx
|       |   |   |-- WorkflowDepartments.jsx
|       |   |   |-- WorkflowMyTasks.jsx
|       |   |   |-- WorkflowTasks.jsx
|       |   |   |-- WorkflowTaskTypes.jsx
|       |   |   `-- WorkflowUploadPending.jsx
|       |   |-- realtime/
|       |   |   `-- workflowSocket.js
|       |   |-- routes/
|       |   |   `-- ProtectedRoute.jsx
|       |   |-- services/
|       |   |   |-- browserImageCompression.service.js
|       |   |   |-- complaints.service.js
|       |   |   |-- orders.service.js
|       |   |   |-- pdfExport.service.js
|       |   |   |-- pisInspectionMasterComparison.service.js
|       |   |   |-- productTypeTemplates.service.js
|       |   |   |-- qcBarcode.service.js
|       |   |   |-- qcImages.service.js
|       |   |   |-- samples.service.js
|       |   |   `-- sampleWorkflow.service.js
|       |   |-- utils/
|       |   |   |-- barcode.js
|       |   |   |-- cbm.js
|       |   |   |-- cbm.test.js
|       |   |   |-- clientSort.js
|       |   |   |-- container.js
|       |   |   |-- date.js
|       |   |   |-- inspectionCbm.js
|       |   |   |-- inspectionCbm.test.js
|       |   |   |-- measuredSizeForm.js
|       |   |   |-- measurementDisplay.js
|       |   |   |-- monthlyShipmentChart.js
|       |   |   |-- monthlyShipmentChart.test.js
|       |   |   |-- omsAssistantState.js
|       |   |   |-- omsAssistantState.test.js
|       |   |   |-- optionText.js
|       |   |   |-- orderStatus.js
|       |   |   |-- productTypeTemplates.js
|       |   |   |-- qcRequests.js
|       |   |   |-- qcRequests.test.js
|       |   |   |-- qcUpdateAccess.js
|       |   |   |-- searchParams.js
|       |   |   |-- shipmentRows.js
|       |   |   |-- shippingPendingReport.js
|       |   |   |-- shippingPendingReport.test.js
|       |   |   |-- vendorCodes.js
|       |   |   |-- vendorSummary.js
|       |   |   |-- vendorSummary.test.js
|       |   |   `-- workflowManifest.js
|       |   |-- App.css
|       |   |-- App.jsx
|       |   |-- index.css
|       |   `-- main.jsx
|       |-- .env.example
|       |-- .gitignore
|       |-- index.html
|       |-- package-lock.json
|       |-- package.json
|       |-- README.md
|       |-- vercel.json
|       `-- vite.config.js
|-- deploy/
|   |-- nginx/
|   |   `-- order-management-system.conf
|   |-- pm2/
|   |   `-- ecosystem.config.cjs
|   `-- scripts/
|       |-- deploy_vps.sh
|       |-- download-oms-backup.ps1
|       `-- oms-backup-export.sh
|-- docs/
|   |-- api-map.md
|   |-- api-map.xlsx
|   |-- MEASUREMENT_MISMATCH_COMPARISON_FLOW.md
|   |-- OMS_ASSISTANT_CONTEXT.md
|   |-- OMS_ASSISTANT.md
|   |-- OMS_KNOWLEDGE_BASE.md
|   |-- OMS_SOURCE_TREE.md
|   |-- PDF_EXPORT_SYSTEM.md
|   |-- PIS_PD_MASTER_ITEM_FLOW.md
|   |-- PRODUCT_TYPE_TEMPLATES_PAGE_GUIDE.md
|   |-- redis-and-jobs.md
|   |-- ROLE_ACCESS_MATRIX.md
|   |-- VPS_MIGRATION.md
|   `-- WORKFLOW_MODULE_MANUAL_TEST_NOTES.md
|-- .codex
|-- .gitignore
|-- .nvmrc
`-- README.md
```

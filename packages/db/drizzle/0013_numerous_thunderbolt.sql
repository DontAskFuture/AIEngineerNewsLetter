CREATE INDEX "document_scores_profile_doc_idx" ON "document_scores" USING btree ("profile_id","document_id");--> statement-breakpoint
CREATE INDEX "document_scores_profile_score_idx" ON "document_scores" USING btree ("profile_id","score");--> statement-breakpoint
CREATE INDEX "documents_sort_time_idx" ON "documents" USING btree (coalesce("source_published_at", "discovered_at"),"id");--> statement-breakpoint
CREATE INDEX "documents_source_id_idx" ON "documents" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "documents_discovered_at_idx" ON "documents" USING btree ("discovered_at");--> statement-breakpoint
CREATE INDEX "fetch_attempts_finished_at_idx" ON "fetch_attempts" USING btree ("finished_at");--> statement-breakpoint
CREATE INDEX "fetch_jobs_endpoint_completed_idx" ON "fetch_jobs" USING btree ("source_endpoint_id","completed_at");--> statement-breakpoint
CREATE INDEX "raw_documents_fetched_at_idx" ON "raw_documents" USING btree ("fetched_at");
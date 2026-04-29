CREATE INDEX "auth_login_attempts_lookup_idx" ON "auth_login_attempts" USING btree ("email","ip_address","attempted_at");

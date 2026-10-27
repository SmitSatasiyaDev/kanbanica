UPDATE "account" SET "account_id" = "user_id" WHERE "provider_id" = 'credential' AND "account_id" <> "user_id";

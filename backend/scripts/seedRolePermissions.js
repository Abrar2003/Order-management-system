const path = require("path");
const mongoose = require("mongoose");
const { loadEnvFiles } = require("../config/loadEnv");
const connectDB = require("../config/connectDB");
const RolePermission = require("../models/rolePermission.model");
const {
  ROLE_KEYS,
  buildAuditActor,
  getDefaultPermissionsForRole,
  mergePermissionsWithDefaults,
} = require("../helpers/permissions");

const hasFlag = (name) => process.argv.includes(`--${name}`);

const systemActor = buildAuditActor({
  name: "seedRolePermissions",
  role: "system",
});

const main = async () => {
  loadEnvFiles({
    cwd: path.resolve(__dirname, ".."),
    preserveExistingEnv: true,
  });

  const force = hasFlag("force");
  await connectDB();

  const results = {
    created: 0,
    skipped: 0,
    updated: 0,
  };

  for (const role of ROLE_KEYS) {
    const existing = await RolePermission.findOne({ role }).lean();
    if (existing && !force) {
      results.skipped += 1;
      console.log(`[skip] ${role}: permissions already exist. Use --force to overwrite.`);
      continue;
    }

    const previousPermissions = existing
      ? mergePermissionsWithDefaults(role, existing.permissions)
      : {};
    const nextPermissions = getDefaultPermissionsForRole(role);
    await RolePermission.findOneAndUpdate(
      { role },
      {
        $set: {
          role,
          permissions: nextPermissions,
          updated_by: systemActor,
          updated_at: new Date(),
        },
        $push: {
          history: {
            $each: [
              {
                action: existing ? "force_seed" : "seed",
                previous_permissions: previousPermissions,
                next_permissions: nextPermissions,
                actor: systemActor,
                timestamp: new Date(),
              },
            ],
            $slice: -25,
          },
        },
      },
      { upsert: true, new: true },
    );

    if (existing) {
      results.updated += 1;
      console.log(`[update] ${role}: default permissions written.`);
    } else {
      results.created += 1;
      console.log(`[create] ${role}: default permissions written.`);
    }
  }

  console.log("Role permission seed complete:", results);
};

main()
  .catch((error) => {
    console.error("Role permission seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close(false).catch(() => {});
  });

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const packagePath = path.join(projectRoot, "package.json");
const manifestPath = path.join(projectRoot, "extension", "CSXS", "manifest.xml");
const hostPath = path.join(projectRoot, "extension", "jsx", "host.jsx");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readVersions() {
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const manifest = fs.readFileSync(manifestPath, "utf8");
  const host = fs.readFileSync(hostPath, "utf8");
  const bundleMatch = manifest.match(/ExtensionBundleVersion="([^"]+)"/);
  const extensionMatch = manifest.match(/<Extension Id="[^"]+" Version="([^"]+)"/);
  const hostMatch = host.match(/ns\.version\s*=\s*"([^"]+)"/);

  if (!bundleMatch || !extensionMatch || !hostMatch) {
    fail("Unable to find every Rove version field.");
  }

  return {
    packageJson,
    manifest,
    host,
    values: {
      package: packageJson.version,
      bundle: bundleMatch[1],
      extension: extensionMatch[1],
      host: hostMatch[1]
    }
  };
}

function check() {
  const versions = readVersions().values;
  const unique = new Set(Object.values(versions));
  if (unique.size !== 1) {
    fail(`Version mismatch: ${JSON.stringify(versions)}`);
  }
  console.log(`Version fields are consistent: ${versions.package}`);
}

function setVersion(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version || "")) {
    fail("Usage: npm run version:set -- X.Y.Z");
  }

  const current = readVersions();
  current.packageJson.version = version;
  fs.writeFileSync(packagePath, `${JSON.stringify(current.packageJson, null, 2)}\n`);
  fs.writeFileSync(
    manifestPath,
    current.manifest
      .replace(/ExtensionBundleVersion="[^"]+"/, `ExtensionBundleVersion="${version}"`)
      .replace(/(<Extension Id="[^"]+" Version=")[^"]+("[^>]*>)/, `$1${version}$2`)
  );
  fs.writeFileSync(hostPath, current.host.replace(/ns\.version\s*=\s*"[^"]+"/, `ns.version = "${version}"`));
  console.log(`Updated Rove version to ${version}`);
  check();
}

const command = process.argv[2] || "check";
if (command === "check") {
  check();
} else if (command === "set") {
  setVersion(process.argv[3]);
} else {
  fail("Usage: node scripts/version.js <check|set> [X.Y.Z]");
}

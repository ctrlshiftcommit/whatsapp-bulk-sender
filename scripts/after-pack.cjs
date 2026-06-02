const path = require("path");

module.exports = async ({ appOutDir, electronPlatformName }) => {
  if (electronPlatformName !== "win32") return;

  const { rcedit } = await import("rcedit");
  await rcedit(path.join(appOutDir, "WASend.exe"), {
    icon: path.resolve(__dirname, "../assets/wasend-icon.ico"),
    "file-version": "1.0.0",
    "product-version": "1.0.0",
    "version-string": {
      CompanyName: "WASend",
      FileDescription: "WASend",
      InternalName: "WASend",
      OriginalFilename: "WASend.exe",
      ProductName: "WASend",
    },
  });
};

// electron-builder afterSign hook. Without an Apple Developer certificate the Mac app is
// unsigned, and Apple Silicon refuses to run unsigned code — so sign it "ad hoc" (no
// identity). This makes it launchable; Gatekeeper still asks the user to confirm once.
const { execSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  console.log(`  • ad-hoc signing ${app}`)
  execSync(`codesign --force --deep --sign - "${app}"`, { stdio: 'inherit' })
}

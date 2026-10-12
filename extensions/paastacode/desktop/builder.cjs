module.exports={
  appId:"cloud.paasta.code",productName:"PaastaCode",copyright:"Copyright © 2026 Paasta",
  forceCodeSigning:process.env.PAASTACODE_SIGNED_RELEASE==="true",
  directories:{app:".artifacts/package/client",output:"dist",buildResources:"desktop"},
  files:["**/*","!node_modules/**/*"],asar:true,asarUnpack:["engine/**","bin/**","src/**"],
  artifactName:"PaastaCode-${version}-${os}-${arch}.${ext}",
  win:{target:["nsis","portable"],icon:"desktop/icon.ico"},
  nsis:{artifactName:"PaastaCode-Setup-${version}-${arch}.exe",oneClick:false,perMachine:false,allowToChangeInstallationDirectory:true,createDesktopShortcut:true,deleteAppDataOnUninstall:false},
  portable:{artifactName:"PaastaCode-Portable-${version}-${arch}.exe"},
  mac:{target:["dmg","zip"],category:"public.app-category.developer-tools",icon:"desktop/icon.png",notarize:process.env.PAASTACODE_SIGNED_RELEASE==="true"},
  linux:{target:["AppImage","deb"],category:"Development",icon:"desktop/icon.png",maintainer:"Paasta <developers@paasta.cloud>"},
  publish:[{provider:"github",owner:"Paasta-Cloud",repo:"PaastaCode"}]
};

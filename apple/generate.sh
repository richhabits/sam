#!/bin/zsh
# Regenerate SAM.xcodeproj from project.yml.
# xcodegen doesn't apply platform filters to embedded content, so the widget
# extension is marked iOS-only here (Safari: iOS + macOS) (same as Xcode's Platforms column).
set -e
cd "${0:A:h}"
xcodegen generate --quiet
python3 - <<'PY'
import re
p = "SAM.xcodeproj/project.pbxproj"
s = open(p).read()
for name in ("SAMWidgets.appex in Embed Foundation Extensions",):
    s = re.sub(r"(/\* %s \*/ = \{isa = PBXBuildFile; )" % re.escape(name), r"\1platformFilters = (ios, ); ", s)
s = re.sub(r"(isa = PBXTargetDependency;\n)(\s+target = \w+ /\* (SAMWidgets) \*/;)",
           r"\1\t\t\tplatformFilters = (ios, );\n\2", s)
# Safari + Share extensions: iPhone, iPad and Mac only (not built for visionOS).
for ext in ("SAMSafari", "SAMShare"):
    s = re.sub(r"(/\* %s.appex in Embed Foundation Extensions \*/ = \{isa = PBXBuildFile; )" % ext, r"\1platformFilters = (ios, macos, ); ", s)
s = re.sub(r"(isa = PBXTargetDependency;\n)(\s+target = \w+ /\* (SAMSafari|SAMShare) \*/;)",
           r"\1\t\t\tplatformFilters = (ios, macos, );\n\2", s)
open(p, "w").write(s)
PY
echo "Generated SAM.xcodeproj"

import Foundation
import Sparkle
import Testing

@Test func timestampReleaseBuildIsNewerThanInstalledTimestampBuild() {
    let installedBuild = "20260728002952"
    let repairedReleaseBuild = "20260728070000"

    #expect(
        SUStandardVersionComparator.default.compareVersion(
            installedBuild,
            toVersion: repairedReleaseBuild
        ) == ComparisonResult.orderedAscending
    )
}

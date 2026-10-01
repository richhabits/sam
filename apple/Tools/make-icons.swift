// Builds every app icon from the one mascot master (mobile/assets/icon.png).
// Run from apple/:  swift Tools/make-icons.swift
import AppKit
import CoreGraphics

let master = "../mobile/assets/icon.png"
let out = "App/Assets.xcassets"
let orange = CGColor(red: 0xD9 / 255, green: 0x4F / 255, blue: 0x1E / 255, alpha: 1)

guard let src = NSImage(contentsOfFile: master)?.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fatalError("can't read \(master)")
}

func render(_ size: Int, _ draw: (CGContext, CGFloat) -> Void) -> CGImage {
    let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.interpolationQuality = .high
    draw(ctx, CGFloat(size))
    return ctx.makeImage()!
}

func write(_ image: CGImage, _ path: String, opaque: Bool = false) {
    var img = image
    if opaque { // App Store rejects alpha in the iOS icon
        img = render(image.width) { ctx, s in
            ctx.setFillColor(orange); ctx.fill(CGRect(x: 0, y: 0, width: s, height: s))
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: s, height: s))
        }
        let rep = NSBitmapImageRep(cgImage: img)
        let data = rep.representation(using: .png, properties: [:])!
        // Strip alpha by re-rendering into an RGB context.
        let rgb = CGContext(data: nil, width: img.width, height: img.height, bitsPerComponent: 8, bytesPerRow: 0,
                            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
        rgb.draw(img, in: CGRect(x: 0, y: 0, width: img.width, height: img.height))
        _ = data
        img = rgb.makeImage()!
    }
    let data = NSBitmapImageRep(cgImage: img).representation(using: .png, properties: [:])!
    try! data.write(to: URL(fileURLWithPath: path))
}

// iOS / iPadOS: full bleed, the system masks it.
write(render(1024) { ctx, s in ctx.draw(src, in: CGRect(x: 0, y: 0, width: s, height: s)) },
      "\(out)/AppIcon.appiconset/icon-1024.png", opaque: true)

// macOS: Apple's grid is an 824pt rounded square centred on 1024, radius ≈ 185.
func macIcon(_ size: Int) -> CGImage {
    render(size) { ctx, s in
        let inset = s * 100 / 1024
        let rect = CGRect(x: inset, y: inset, width: s - inset * 2, height: s - inset * 2)
        let path = CGPath(roundedRect: rect, cornerWidth: s * 185 / 1024, cornerHeight: s * 185 / 1024, transform: nil)
        ctx.setShadow(offset: CGSize(width: 0, height: -s * 10 / 1024), blur: s * 20 / 1024,
                      color: CGColor(gray: 0, alpha: 0.3))
        ctx.addPath(path); ctx.setFillColor(orange); ctx.fillPath()
        ctx.setShadow(offset: .zero, blur: 0)
        ctx.addPath(path); ctx.clip()
        ctx.draw(src, in: rect)
    }
}
for (pt, scale) in [(16, 1), (16, 2), (32, 1), (32, 2), (128, 1), (128, 2), (256, 1), (256, 2), (512, 1), (512, 2)] {
    write(macIcon(pt * scale), "\(out)/AppIcon.appiconset/mac-\(pt)@\(scale)x.png")
}

// visionOS: opaque back layer, mascot on the front layer for parallax.
let vision = "\(out)/VisionAppIcon.solidimagestack"
write(render(1024) { ctx, s in ctx.setFillColor(orange); ctx.fill(CGRect(x: 0, y: 0, width: s, height: s)) },
      "\(vision)/Back.solidimagestacklayer/Content.imageset/back.png", opaque: true)
write(render(1024) { ctx, s in ctx.draw(src, in: CGRect(x: 0, y: 0, width: s, height: s)) },
      "\(vision)/Front.solidimagestacklayer/Content.imageset/front.png")
print("icons written")

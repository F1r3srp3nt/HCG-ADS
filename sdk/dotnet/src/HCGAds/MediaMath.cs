using System;

namespace HCG.Ads
{
    /// <summary>A rectangle in pixels.</summary>
    public readonly struct PixelRect : IEquatable<PixelRect>
    {
        public PixelRect(double x, double y, double width, double height) { X = x; Y = y; Width = width; Height = height; }
        public double X { get; }
        public double Y { get; }
        public double Width { get; }
        public double Height { get; }
        public bool Equals(PixelRect o) => X == o.X && Y == o.Y && Width == o.Width && Height == o.Height;
        public override bool Equals(object? obj) => obj is PixelRect r && Equals(r);
        public override int GetHashCode() => (X, Y, Width, Height).GetHashCode();
        public override string ToString() => $"{X},{Y} {Width}x{Height}";
    }

    /// <summary>Media framing. Media is cropped explicitly or fitted; it is never stretched.</summary>
    public static class MediaMath
    {
        /// <summary>The source-pixel rectangle a normalised crop selects (clamped to the image).</summary>
        public static PixelRect CropToSource(CropRect crop, double sourceWidth, double sourceHeight)
        {
            if (sourceWidth <= 0 || sourceHeight <= 0) return new PixelRect(0, 0, 0, 0);
            double x = Clamp01(crop.X), y = Clamp01(crop.Y);
            double w = Math.Min(Clamp01(crop.Width), 1 - x), h = Math.Min(Clamp01(crop.Height), 1 - y);
            return new PixelRect(x * sourceWidth, y * sourceHeight, w * sourceWidth, h * sourceHeight);
        }

        /// <summary>
        /// The largest rectangle with the source's aspect ratio that fits inside the box, centred
        /// (letterboxing). Both dimensions use one scale factor, so nothing is ever stretched.
        /// </summary>
        public static PixelRect AspectFit(double sourceWidth, double sourceHeight, double boxWidth, double boxHeight)
        {
            if (sourceWidth <= 0 || sourceHeight <= 0 || boxWidth <= 0 || boxHeight <= 0) return new PixelRect(0, 0, 0, 0);
            var scale = Math.Min(boxWidth / sourceWidth, boxHeight / sourceHeight);
            double w = sourceWidth * scale, h = sourceHeight * scale;
            return new PixelRect((boxWidth - w) / 2, (boxHeight - h) / 2, w, h);
        }

        /// <summary>Aspect ratio of a crop on media of a known size, or null.</summary>
        public static double? CropAspect(AdMedia media)
        {
            if (media.Crop is null || media.Width is not int w || media.Height is not int h || media.Crop.Height <= 0 || h == 0) return null;
            return media.Crop.Width * w / (media.Crop.Height * h);
        }

        private static double Clamp01(double v) => v < 0 ? 0 : v > 1 ? 1 : v;
    }
}

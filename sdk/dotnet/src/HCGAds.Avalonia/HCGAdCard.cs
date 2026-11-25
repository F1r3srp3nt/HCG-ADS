using System;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using HCGPixelRect = HCG.Ads.PixelRect;

namespace HCG.Ads.Avalonia
{
    /// <summary>
    /// Renders one <see cref="RenderableAd"/>. The disclosure label is always visible; all ad text is set
    /// as plain text (never parsed); media is shown with its explicit crop or fitted uniformly, never stretched.
    /// </summary>
    public sealed class HCGAdCard : Border
    {
        public HCGAdCard(RenderableAd ad, PlacementInfo? placement, Bitmap? image = null)
        {
            Ad = ad;
            CornerRadius = new CornerRadius(10);
            BorderThickness = new Thickness(1);
            BorderBrush = new SolidColorBrush(Color.FromArgb(36, 128, 128, 128));
            ClipToBounds = true;
            if (placement?.Responsive == "fixed" && placement.Width is int w) Width = w;
            if (placement?.Responsive != "responsive-native" && placement?.Height is int h) Height = h;

            var horizontal = placement?.IsHorizontal ?? false;
            var text = new StackPanel { Spacing = 4, Margin = new Thickness(12, 10) };
            text.Children.Add(new TextBlock { Text = ad.SponsorName, FontSize = 11, Opacity = 0.7, Name = "Sponsor" });
            text.Children.Add(new TextBlock { Text = ad.Headline, FontWeight = FontWeight.SemiBold, TextWrapping = TextWrapping.Wrap, MaxLines = 3, Name = "Headline" });
            if (!horizontal && !string.IsNullOrEmpty(ad.Description))
                text.Children.Add(new TextBlock { Text = ad.Description, TextWrapping = TextWrapping.Wrap, MaxLines = 3, Opacity = 0.8, Name = "Description" });
            CallToAction = new Button { Content = new TextBlock { Text = ad.CallToAction }, Name = "CallToAction" };
            text.Children.Add(CallToAction);

            var layout = new Grid();
            if (image != null && ad.Media != null && ad.Media.Kind != "video")
            {
                var media = new Image { Source = Frame(image, ad.Media), Stretch = Stretch.Uniform, Name = "Media" };
                if (horizontal)
                {
                    layout.ColumnDefinitions = new ColumnDefinitions("120,*");
                    Grid.SetColumn(text, 1);
                }
                else
                {
                    layout.RowDefinitions = new RowDefinitions("Auto,*");
                    Grid.SetRow(text, 1);
                }
                layout.Children.Add(media);
            }
            layout.Children.Add(text);

            var disclosure = new Border
            {
                Background = new SolidColorBrush(Color.FromArgb(200, 0, 0, 0)),
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(7, 2),
                Margin = new Thickness(6),
                HorizontalAlignment = HorizontalAlignment.Left,
                VerticalAlignment = VerticalAlignment.Top,
                IsHitTestVisible = false,
                Child = new TextBlock { Text = ad.Disclosure, Foreground = Brushes.White, FontSize = 10, FontWeight = FontWeight.SemiBold, Name = "Disclosure" },
            };
            var root = new Panel();
            root.Children.Add(layout);
            root.Children.Add(disclosure);
            Child = root;
            AutomationPropertiesName = $"{ad.Disclosure}: {ad.Headline}, {ad.SponsorName}";
            global::Avalonia.Automation.AutomationProperties.SetName(this, AutomationPropertiesName);
        }

        public RenderableAd Ad { get; }
        public Button CallToAction { get; }
        public string AutomationPropertiesName { get; }

        /// <summary>The explicit crop of the media, or the whole image. Uniform scaling only.</summary>
        public static IImage Frame(Bitmap image, AdMedia media)
        {
            if (media.Crop == null) return image;
            HCGPixelRect r = MediaMath.CropToSource(media.Crop, image.PixelSize.Width, image.PixelSize.Height);
            var rect = new global::Avalonia.PixelRect((int)Math.Round(r.X), (int)Math.Round(r.Y), Math.Max(1, (int)Math.Round(r.Width)), Math.Max(1, (int)Math.Round(r.Height)));
            return new CroppedBitmap(image, rect);
        }
    }
}

using System;
using System.Collections.Generic;
using System.Speech.Synthesis;
using System.Speech.AudioFormat;

public sealed class NarrationWord
{
    public int Position { get; set; }
    public double Seconds { get; set; }
}

public static class DemoNarration
{
    public static NarrationWord[] Synthesize(string text, string path)
    {
        var words = new List<NarrationWord>();
        using (var voice = new SpeechSynthesizer())
        {
            voice.SelectVoice("Microsoft Zira Desktop");
            voice.Rate = 0;
            voice.SpeakProgress += (sender, e) => {
                lock (words) words.Add(new NarrationWord {
                    Position = e.CharacterPosition, Seconds = e.AudioPosition.TotalSeconds
                });
            };
            // Keep the output clock identical to SpeakProgress's 16 kHz clock.
            voice.SetOutputToWaveFile(path, new SpeechAudioFormatInfo(
                16000, AudioBitsPerSample.Sixteen, AudioChannel.Mono));
            voice.Speak(text);
            voice.SetOutputToNull();
        }
        lock (words) return words.ToArray();
    }
}

// junto-audio: captures the sound of ONE program (a browser window's process tree) with WASAPI process loopback,
// so a Discord call or other apps are not sent to friends. Built by ferramentas\compilar-audio.js with the csc.exe
// that ships with Windows (.NET Framework 4, C# 5). x64 only.
// Usage:
//   junto-audio.exe info <hwnd> [<hwnd> ...]   -> one line per window: "<hwnd> <pid> <exe>"
//   junto-audio.exe captar <hwnd>              -> stdout: raw PCM s16le 48000 Hz stereo, forever, with the program's volume-mixer
//                                                 level undone; stderr: "ok <pid> <exe>" or "erro <motivo>"
// Ends when stdin closes (the app died) or the target process ends.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace Junto
{
    [StructLayout(LayoutKind.Sequential)]
    struct AtivacaoParams { public int ActivationType; public uint TargetProcessId; public int ProcessLoopbackMode; }

    [StructLayout(LayoutKind.Explicit, Size = 24)]
    struct PropVariantBlob { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public uint cbSize; [FieldOffset(16)] public IntPtr pBlobData; }

    [StructLayout(LayoutKind.Sequential, Pack = 2)]
    struct WaveFormatEx { public ushort wFormatTag; public ushort nChannels; public uint nSamplesPerSec; public uint nAvgBytesPerSec; public ushort nBlockAlign; public ushort wBitsPerSample; public ushort cbSize; }

    [ComImport, Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceAsyncOperation
    {
        void GetActivateResult(out int activateResult, [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
    }

    [ComImport, Guid("41D949AB-9862-444A-80F6-C261334DA5EB"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IActivateAudioInterfaceCompletionHandler
    {
        void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op);
    }

    [ComImport, Guid("94ea2b94-e9cc-49e0-c0ff-ee64ca8f5b90"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAgileObject { }

    [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioClient
    {
        [PreserveSig] int Initialize(int shareMode, uint streamFlags, long bufferDuration, long periodicity, IntPtr format, IntPtr sessionGuid);
        [PreserveSig] int GetBufferSize(out uint frames);
        [PreserveSig] int GetStreamLatency(out long latency);
        [PreserveSig] int GetCurrentPadding(out uint padding);
        [PreserveSig] int IsFormatSupported(int shareMode, IntPtr format, out IntPtr closest);
        [PreserveSig] int GetMixFormat(out IntPtr format);
        [PreserveSig] int GetDevicePeriod(out long def, out long min);
        [PreserveSig] int Start();
        [PreserveSig] int Stop();
        [PreserveSig] int Reset();
        [PreserveSig] int SetEventHandle(IntPtr handle);
        [PreserveSig] int GetService([MarshalAs(UnmanagedType.LPStruct)] Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
    }

    [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioCaptureClient
    {
        [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong devicePosition, out ulong qpcPosition);
        [PreserveSig] int ReleaseBuffer(uint frames);
        [PreserveSig] int GetNextPacketSize(out uint frames);
    }

    // Per-program volume (Windows volume mixer). Process loopback hands us the sound AFTER that volume, so a browser
    // set to 2 % would reach friends almost silent: we read it and undo it.
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class MMDeviceEnumerator { }

    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDeviceEnumerator
    {
        [PreserveSig] int EnumAudioEndpoints(int flow, int mask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
    }

    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IMMDevice
    {
        [PreserveSig] int Activate([MarshalAs(UnmanagedType.LPStruct)] Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
    }

    [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionManager2
    {
        [PreserveSig] int GetAudioSessionControl(IntPtr a, int b, out IntPtr c);
        [PreserveSig] int GetSimpleAudioVolume(IntPtr a, int b, out IntPtr c);
        [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator e);
    }

    [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionEnumerator
    {
        [PreserveSig] int GetCount(out int n);
        [PreserveSig] int GetSession(int i, out IAudioSessionControl2 s);
    }

    [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioSessionControl2
    {
        [PreserveSig] int GetState(out int s);
        [PreserveSig] int GetDisplayName(out IntPtr a);
        [PreserveSig] int SetDisplayName(IntPtr a, IntPtr b);
        [PreserveSig] int GetIconPath(out IntPtr a);
        [PreserveSig] int SetIconPath(IntPtr a, IntPtr b);
        [PreserveSig] int GetGroupingParam(out Guid a);
        [PreserveSig] int SetGroupingParam(IntPtr a, IntPtr b);
        [PreserveSig] int RegisterAudioSessionNotification(IntPtr a);
        [PreserveSig] int UnregisterAudioSessionNotification(IntPtr a);
        [PreserveSig] int GetSessionIdentifier(out IntPtr a);
        [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr a);
        [PreserveSig] int GetProcessId(out uint pid);
    }

    [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface ISimpleAudioVolume
    {
        [PreserveSig] int SetMasterVolume(float v, IntPtr ctx);
        [PreserveSig] int GetMasterVolume(out float v);
        [PreserveSig] int SetMute(int m, IntPtr ctx);
        [PreserveSig] int GetMute(out int m);
    }

    [ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IAudioMeterInformation
    {
        [PreserveSig] int GetPeakValue(out float peak);
    }

    [ComVisible(true)]
    class Concluido : IActivateAudioInterfaceCompletionHandler, IAgileObject
    {
        public readonly ManualResetEvent Feito = new ManualResetEvent(false);
        public int Hr = -1;
        public object Cliente;
        public void ActivateCompleted(IActivateAudioInterfaceAsyncOperation op)
        {
            try { int hr; object o; op.GetActivateResult(out hr, out o); Hr = hr; Cliente = o; }
            catch (Exception e) { Hr = Marshal.GetHRForException(e); }
            Feito.Set();
        }
    }

    static class Programa
    {
        const int TAXA = 48000, CANAIS = 2, BLOCO = 4, BLOCO_F = 8;

        [DllImport("Mmdevapi.dll", ExactSpelling = true, PreserveSig = false)]
        static extern void ActivateAudioInterfaceAsync([MarshalAs(UnmanagedType.LPWStr)] string path, [MarshalAs(UnmanagedType.LPStruct)] Guid riid,
            IntPtr activationParams, IActivateAudioInterfaceCompletionHandler handler, out IActivateAudioInterfaceAsyncOperation op);

        [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
        [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
        [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snap, ref ProcEntry e);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr snap, ref ProcEntry e);
        [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct ProcEntry
        {
            public uint dwSize, cntUsage, th32ProcessID; public IntPtr th32DefaultHeapID; public uint th32ModuleID, cntThreads, th32ParentProcessID;
            public int pcPriClassBase; public uint dwFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string szExeFile;
        }

        static void Erro(string m) { try { Console.Error.WriteLine("erro " + m); Console.Error.Flush(); } catch { } }

        // pid -> (parent, exe)
        static Dictionary<uint, KeyValuePair<uint, string>> Processos()
        {
            var r = new Dictionary<uint, KeyValuePair<uint, string>>();
            IntPtr snap = CreateToolhelp32Snapshot(2, 0);
            if (snap == IntPtr.Zero || snap == new IntPtr(-1)) return r;
            var e = new ProcEntry(); e.dwSize = (uint)Marshal.SizeOf(typeof(ProcEntry));
            if (Process32FirstW(snap, ref e))
                do { r[e.th32ProcessID] = new KeyValuePair<uint, string>(e.th32ParentProcessID, e.szExeFile ?? ""); } while (Process32NextW(snap, ref e));
            CloseHandle(snap);
            return r;
        }

        // Window -> root of its program: walks up while the parent is the same exe (browsers are a tree of the same exe).
        static uint RaizDe(IntPtr hwnd, Dictionary<uint, KeyValuePair<uint, string>> ps, out string exe)
        {
            exe = "";
            uint pid; GetWindowThreadProcessId(hwnd, out pid);
            if (pid == 0) return 0;
            KeyValuePair<uint, string> p;
            if (!ps.TryGetValue(pid, out p)) return pid;
            exe = p.Value;
            for (int i = 0; i < 16; i++)
            {
                KeyValuePair<uint, string> pai;
                if (p.Key == 0 || p.Key == pid || !ps.TryGetValue(p.Key, out pai) || !string.Equals(pai.Value, exe, StringComparison.OrdinalIgnoreCase)) break;
                pid = p.Key; p = pai;
            }
            return pid;
        }

        // root + all its descendants
        static HashSet<uint> Arvore(uint raiz)
        {
            var ps = Processos();
            var r = new HashSet<uint> { raiz };
            for (bool mudou = true; mudou;)
            {
                mudou = false;
                foreach (var kv in ps)
                    if (!r.Contains(kv.Key) && r.Contains(kv.Value.Key) && kv.Key != kv.Value.Key) { r.Add(kv.Key); mudou = true; }
            }
            return r;
        }

        // Volume-mixer level of the program's session that is sounding now (loudest peak meter on the default output).
        // A browser can own several sessions (one silent at 100 %, the playing one at 2 %). -1 = nothing playing: keep the last.
        static string Dbg = "";
        static float VolumeDe(HashSet<uint> pids)
        {
            Dbg = "";
            float melhor = -1, pico = 0.00001f;
            try
            {
                var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
                IMMDevice dev;
                if (en.GetDefaultAudioEndpoint(0, 1, out dev) != 0 || dev == null) return -1;
                object o;
                if (dev.Activate(typeof(IAudioSessionManager2).GUID, 23, IntPtr.Zero, out o) != 0 || o == null) return -1;
                IAudioSessionEnumerator lista;
                if (((IAudioSessionManager2)o).GetSessionEnumerator(out lista) != 0 || lista == null) return -1;
                int n; lista.GetCount(out n);
                for (int i = 0; i < n; i++)
                {
                    IAudioSessionControl2 s;
                    if (lista.GetSession(i, out s) != 0 || s == null) continue;
                    uint pid; int estado; float v, p;
                    if (s.GetProcessId(out pid) != 0 || !pids.Contains(pid)) continue;
                    if (s.GetState(out estado) != 0 || estado != 1) continue;
                    if (((ISimpleAudioVolume)s).GetMasterVolume(out v) != 0) continue;
                    if (((IAudioMeterInformation)s).GetPeakValue(out p) != 0) continue;
                    Dbg += " " + pid + "=" + v + "/" + p;
                    if (p > pico) { pico = p; melhor = v; }
                }
            }
            catch (Exception ex) { Dbg += " erro " + ex.Message; return -1; }
            return melhor;
        }

        static IntPtr Hwnd(string s)
        {
            long v; return long.TryParse(s, out v) ? new IntPtr(v) : IntPtr.Zero;
        }

        [MTAThread]
        static int Main(string[] args)
        {
            if (args.Length >= 1 && args[0] == "info")
            {
                var ps = Processos();
                var sb = new StringBuilder();
                for (int i = 1; i < args.Length; i++)
                {
                    IntPtr h = Hwnd(args[i]); string exe = ""; uint pid = 0;
                    if (h != IntPtr.Zero && IsWindow(h)) pid = RaizDe(h, ps, out exe);
                    sb.Append(args[i]).Append(' ').Append(pid).Append(' ').Append(exe).Append('\n');
                }
                Console.Out.Write(sb.ToString());
                return 0;
            }
            if (args.Length == 2 && args[0] == "captar") return Captar(Hwnd(args[1]));
            Erro("uso");
            return 2;
        }

        static int Captar(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero || !IsWindow(hwnd)) { Erro("janela_sumiu"); return 3; }
            string exe;
            uint pid = RaizDe(hwnd, Processos(), out exe);
            if (pid == 0) { Erro("janela_sumiu"); return 3; }

            var ap = new AtivacaoParams { ActivationType = 1, TargetProcessId = pid, ProcessLoopbackMode = 0 }; // PROCESS_LOOPBACK, INCLUDE_TARGET_PROCESS_TREE
            IntPtr pAp = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(AtivacaoParams)));
            Marshal.StructureToPtr(ap, pAp, false);
            var pv = new PropVariantBlob { vt = 65, cbSize = (uint)Marshal.SizeOf(typeof(AtivacaoParams)), pBlobData = pAp }; // VT_BLOB
            IntPtr pPv = Marshal.AllocHGlobal(24);
            Marshal.StructureToPtr(pv, pPv, false);

            var fim = new Concluido();
            IAudioClient cliente;
            try
            {
                IActivateAudioInterfaceAsyncOperation op;
                ActivateAudioInterfaceAsync("VAD\\Process_Loopback", typeof(IAudioClient).GUID, pPv, fim, out op);
                if (!fim.Feito.WaitOne(5000)) { Erro("ativar_tempo"); return 4; }
                if (fim.Hr != 0 || fim.Cliente == null) { Erro("ativar 0x" + fim.Hr.ToString("X8")); return 4; }
                cliente = (IAudioClient)fim.Cliente;
            }
            catch (Exception e) { Erro("ativar " + e.GetType().Name + " 0x" + Marshal.GetHRForException(e).ToString("X8")); return 4; }

            // 32-bit float in (no precision lost before the volume compensation), s16 out
            var wf = new WaveFormatEx { wFormatTag = 3, nChannels = CANAIS, nSamplesPerSec = TAXA, nAvgBytesPerSec = TAXA * BLOCO_F, nBlockAlign = BLOCO_F, wBitsPerSample = 32, cbSize = 0 };
            IntPtr pWf = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(WaveFormatEx)));
            Marshal.StructureToPtr(wf, pWf, false);
            // LOOPBACK | EVENTCALLBACK | AUTOCONVERTPCM | SRC_DEFAULT_QUALITY, 200 ms buffer
            int hr = cliente.Initialize(0, 0x00020000u | 0x00040000u | 0x80000000u | 0x08000000u, 2000000, 0, pWf, IntPtr.Zero);
            if (hr != 0) { Erro("iniciar 0x" + hr.ToString("X8")); return 5; }
            var evento = new AutoResetEvent(false);
            hr = cliente.SetEventHandle(evento.SafeWaitHandle.DangerousGetHandle());
            if (hr != 0) { Erro("evento 0x" + hr.ToString("X8")); return 5; }
            object svc;
            hr = cliente.GetService(typeof(IAudioCaptureClient).GUID, out svc);
            if (hr != 0 || svc == null) { Erro("servico 0x" + hr.ToString("X8")); return 5; }
            var cap = (IAudioCaptureClient)svc;
            hr = cliente.Start();
            if (hr != 0) { Erro("comecar 0x" + hr.ToString("X8")); return 5; }

            Console.Error.WriteLine("ok " + pid + " " + exe);
            Console.Error.Flush();

            var saida = Console.OpenStandardOutput();
            bool acabou = false;
            // stdin closed = the app is gone: stop.
            var vigia = new Thread(() => { try { var e = Console.OpenStandardInput(); var b = new byte[64]; while (e.Read(b, 0, b.Length) > 0) { } } catch { } acabou = true; evento.Set(); });
            vigia.IsBackground = true; vigia.Start();

            Process alvo = null;
            try { alvo = Process.GetProcessById((int)pid); } catch { }

            var relogio = Stopwatch.StartNew();
            long emitidos = 0; // frames written; silence pads to the wall clock when the program is quiet (no packets then)
            byte[] buf = new byte[TAXA * BLOCO]; // 1 s
            float[] amostras = new float[TAXA * CANAIS];
            HashSet<uint> arvore = Arvore(pid);
            bool depurar = Environment.GetEnvironmentVariable("JUNTO_AUDIO_DEPURAR") == "1";
            float ganho = 1, alvoGanho = 1;
            // Leveller: Windows also lowers other programs during a call (communications ducking, invisible to us) and
            // the page may have its own low volume. Slowly raise quiet sound (up to 16x), limiter on peaks.
            float nivel = 1, alvoNivel = 1, picoBloco = 0; int noBloco = 0, posPico = 0;
            float[] picos = new float[80];
            long proxVolume = 0, proxArvore = 2000;
            try
            {
                while (!acabou)
                {
                    evento.WaitOne(20);
                    long agora = relogio.ElapsedMilliseconds;
                    if (agora >= proxArvore || agora < proxArvore - 4000) { arvore = Arvore(pid); proxArvore = agora + 2000; }
                    if (agora >= proxVolume || agora < proxVolume - 1000)
                    {
                        float v = VolumeDe(arvore);
                        if (v > 0.0001f) alvoGanho = Math.Min(100f, 1f / v);
                        if (depurar) Console.Error.WriteLine("volume " + v + " ganho " + alvoGanho + " processos " + arvore.Count + Dbg);
                        proxVolume = agora + 300;
                    }
                    uint n;
                    while (cap.GetNextPacketSize(out n) == 0 && n > 0)
                    {
                        IntPtr dados; uint frames, flags; ulong p1, p2;
                        if (cap.GetBuffer(out dados, out frames, out flags, out p1, out p2) != 0) break;
                        int bytes = (int)frames * BLOCO, total = (int)frames * CANAIS;
                        if (bytes > buf.Length) buf = new byte[bytes];
                        if (total > amostras.Length) amostras = new float[total];
                        if ((flags & 2) != 0) Array.Clear(buf, 0, bytes); // AUDCLNT_BUFFERFLAGS_SILENT
                        else
                        {
                            Marshal.Copy(dados, amostras, 0, total);
                            // glide to the new gain over this packet (no click when the slider moves)
                            float passo = (alvoGanho - ganho) / Math.Max(1, total);
                            for (int i = 0; i + 1 < total; i += 2)
                            {
                                ganho += passo * 2;
                                float l = amostras[i] * ganho, r = amostras[i + 1] * ganho;
                                float a = Math.Max(Math.Abs(l), Math.Abs(r));
                                if (a > picoBloco) picoBloco = a;
                                if (++noBloco >= TAXA / 10) // 100 ms blocks -> loudest of the last 8 s
                                {
                                    picos[posPico] = picoBloco; posPico = (posPico + 1) % picos.Length;
                                    float m = 0; foreach (float q in picos) if (q > m) m = q;
                                    if (m > 0.003f) alvoNivel = Math.Max(1f, Math.Min(16f, 0.9f / m)); // silence: hold
                                    picoBloco = 0; noBloco = 0;
                                }
                                nivel += (alvoNivel - nivel) * 0.00002f; // ~1 s glide
                                if (a * nivel > 0.98f) nivel = 0.98f / a; // limiter: never clip
                                l *= nivel; r *= nivel;
                                int x = (int)(l * 32767f), y = (int)(r * 32767f);
                                buf[i * 2] = (byte)x; buf[i * 2 + 1] = (byte)(x >> 8);
                                buf[i * 2 + 2] = (byte)y; buf[i * 2 + 3] = (byte)(y >> 8);
                            }
                            ganho = alvoGanho;
                        }
                        cap.ReleaseBuffer(frames);
                        saida.Write(buf, 0, bytes);
                        emitidos += frames;
                    }
                    long devido = relogio.ElapsedMilliseconds * TAXA / 1000;
                    if (devido - emitidos > TAXA / 25) // over 40 ms behind: fill with silence up to 20 ms behind
                    {
                        long falta = devido - emitidos - TAXA / 50;
                        if (falta > TAXA) { emitidos = devido - TAXA / 50; falta = TAXA / 50; } // long gap (e.g. sleep): don't burst seconds of silence
                        int bytes = (int)falta * BLOCO;
                        if (bytes > buf.Length) buf = new byte[bytes];
                        Array.Clear(buf, 0, bytes);
                        saida.Write(buf, 0, bytes);
                        emitidos += falta;
                    }
                    if (emitidos - devido > TAXA / 5) { relogio.Reset(); relogio.Start(); emitidos = 0; } // way ahead (burst): resync the clock
                    saida.Flush();
                    if (alvo != null && alvo.HasExited) { Erro("programa_fechou"); break; }
                }
            }
            catch (IOException) { } // stdout closed
            try { cliente.Stop(); } catch { }
            return 0;
        }
    }
}

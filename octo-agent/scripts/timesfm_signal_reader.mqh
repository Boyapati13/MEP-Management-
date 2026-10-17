//+------------------------------------------------------------------+
//|  timesfm_signal_reader.mqh                                       |
//|  Whale Suite — TimesFM Signal File Reader                        |
//|                                                                  |
//|  Reads the JSON signal written by timesfm_forecaster.py and     |
//|  exposes a simple gate function for BUY / SELL decisions.        |
//|                                                                  |
//|  USAGE IN whale_v7_predictive.mq5                               |
//|  ─────────────────────────────────────────────────────────────── |
//|  #include "timesfm_signal_reader.mqh"                            |
//|                                                                  |
//|  // In OnTick() before trade entry:                              |
//|  ENUM_TFM_BIAS tfmBias;                                          |
//|  double        tfmConf;                                          |
//|  if(ReadTimesFMSignal(tfmBias, tfmConf))                         |
//|  {                                                               |
//|     if(g3B && tfmBias != TFM_BEAR)  PlaceBuy(...);              |
//|     if(g3S && tfmBias != TFM_BULL)  PlaceSell(...);             |
//|  }                                                               |
//+------------------------------------------------------------------+
#ifndef TIMESFM_SIGNAL_READER_MQH
#define TIMESFM_SIGNAL_READER_MQH

//--- How old (seconds) before we consider the signal stale and ignore it
input int InpTFMMaxAgeSeconds = 600;   // 10 min default

//--- Minimum confidence required (0.0–1.0) to use the directional bias
input double InpTFMMinConfidence = 0.60;

enum ENUM_TFM_BIAS
  {
   TFM_BULL    = 1,    // TimesFM sees upward price continuation
   TFM_BEAR    = -1,   // TimesFM sees downward price continuation
   TFM_NEUTRAL = 0,    // Model uncertain or signal stale
  };

//+------------------------------------------------------------------+
// Locate the signal file. Looks in the common Files folder first,
// then in the MQL5/Files folder (standard sandbox path).
// Adjust the path to wherever timesfm_forecaster.py writes the file.
//+------------------------------------------------------------------+
string GetSignalFilePath(bool common = true)
  {
   // Edit this path to match where timesfm_forecaster.py runs
   // Default: MQL5 common Files (cross-terminal accessible)
   if(common)
      return TerminalInfoString(TERMINAL_COMMONDATA_PATH) +
             "\\Files\\timesfm_signal.json";
   else
      return TerminalInfoString(TERMINAL_DATA_PATH) +
             "\\MQL5\\Files\\timesfm_signal.json";
  }

//+------------------------------------------------------------------+
// Minimal JSON value extractor (no external libraries needed).
// Finds "key": value|"string" and returns the raw token.
//+------------------------------------------------------------------+
string ExtractJsonValue(const string &json, const string key)
  {
   string search = "\"" + key + "\":";
   int pos = StringFind(json, search);
   if(pos < 0) return "";
   pos += StringLen(search);
   // Skip whitespace
   while(pos < StringLen(json) && (StringGetCharacter(json, pos) == ' ' ||
                                    StringGetCharacter(json, pos) == '\t'))
      pos++;
   if(pos >= StringLen(json)) return "";

   ushort c = StringGetCharacter(json, pos);
   if(c == '"')
     {
      // String value
      pos++;
      int end = StringFind(json, "\"", pos);
      if(end < 0) return "";
      return StringSubstr(json, pos, end - pos);
     }
   else
     {
      // Numeric / boolean value
      int end = pos;
      while(end < StringLen(json) &&
            StringGetCharacter(json, end) != ',' &&
            StringGetCharacter(json, end) != '}' &&
            StringGetCharacter(json, end) != '\n' &&
            StringGetCharacter(json, end) != '\r')
         end++;
      return StringTrimRight(StringSubstr(json, pos, end - pos));
     }
  }

//+------------------------------------------------------------------+
// Parse ISO-8601 datetime string "2025-01-01T12:00:00+00:00"
// Returns unix timestamp (seconds), or 0 on parse failure.
//+------------------------------------------------------------------+
datetime ParseISO8601(const string dt)
  {
   // Use MQL5 StringToTime — it handles "YYYY.MM.DD HH:MM:SS"
   // Convert ISO-8601 to that format
   string s = dt;
   StringReplace(s, "T", " ");
   StringReplace(s, "Z", "");
   // Trim timezone suffix like +02:00
   int tzPos = StringFind(s, "+", 10);
   if(tzPos > 0) s = StringSubstr(s, 0, tzPos);
   tzPos = StringFind(s, "-", 10);
   if(tzPos > 0) s = StringSubstr(s, 0, tzPos);
   StringReplace(s, "-", ".");
   return StringToTime(s);
  }

//+------------------------------------------------------------------+
// Main function: read timesfm_signal.json and populate bias / conf.
// Returns true if signal was read and is fresh; false if stale/missing.
//+------------------------------------------------------------------+
bool ReadTimesFMSignal(ENUM_TFM_BIAS &outBias, double &outConf,
                        bool useCommonPath = true)
  {
   outBias = TFM_NEUTRAL;
   outConf = 0.0;

   string path = GetSignalFilePath(useCommonPath);
   int handle  = FileOpen(path, FILE_READ | FILE_TXT | FILE_ANSI | FILE_COMMON);
   if(handle == INVALID_HANDLE && !useCommonPath)
     {
      path   = GetSignalFilePath(false);
      handle = FileOpen(path, FILE_READ | FILE_TXT | FILE_ANSI);
     }
   if(handle == INVALID_HANDLE)
     {
      // No signal file yet — allow all trades (don't block)
      return false;
     }

   string json = "";
   while(!FileIsEnding(handle))
      json += FileReadString(handle);
   FileClose(handle);

   if(StringLen(json) < 10)
     {
      Print("TimesFM: signal file empty.");
      return false;
     }

   // ── Freshness check ────────────────────────────────────────────
   string ts = ExtractJsonValue(json, "generated_at");
   if(StringLen(ts) > 0)
     {
      datetime sigTime = ParseISO8601(ts);
      datetime now     = TimeGMT();
      if((int)(now - sigTime) > InpTFMMaxAgeSeconds)
        {
         Print("TimesFM: signal stale (age=", (int)(now - sigTime), "s). Ignoring.");
         return false;
        }
     }

   // ── Error check ────────────────────────────────────────────────
   string errVal = ExtractJsonValue(json, "error");
   if(StringLen(errVal) > 0 && errVal != "null")
     {
      Print("TimesFM: signal has error: ", errVal);
      return false;
     }

   // ── Confidence ─────────────────────────────────────────────────
   string confStr = ExtractJsonValue(json, "confidence");
   outConf = StringToDouble(confStr);
   if(outConf < InpTFMMinConfidence)
     {
      outBias = TFM_NEUTRAL;
      return true;  // signal read but low confidence → neutral
     }

   // ── Bias ───────────────────────────────────────────────────────
   string biasStr = ExtractJsonValue(json, "bias");
   if(biasStr == "BULL")       outBias = TFM_BULL;
   else if(biasStr == "BEAR")  outBias = TFM_BEAR;
   else                         outBias = TFM_NEUTRAL;

   string pct = ExtractJsonValue(json, "pct_change");
   Print("TimesFM Gate | Bias=", biasStr,
         " Conf=", DoubleToString(outConf * 100.0, 1), "%",
         " Move=", pct, "%");
   return true;
  }

#endif // TIMESFM_SIGNAL_READER_MQH

package expo.modules.robotts

import android.net.Uri
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import java.io.File
import java.util.Locale
import java.util.UUID

private const val ERROR_CODE = "ERR_ROBO_TTS"
private const val STALE_FILE_MS = 5 * 60_000L

class SynthesisOptions : Record {
  @Field
  val language: String? = null

  @Field
  val rate: Float = 1f

  @Field
  val pitch: Float = 1f
}

/**
 * Renders speech to a WAV file with the phone's text-to-speech engine instead
 * of playing it, so the app can stream the audio to the robot car's speaker.
 * expo-speech can only play through the phone speaker.
 */
class RoboTtsModule : Module() {
  private enum class EngineState { IDLE, INITIALIZING, READY }

  private class Job(val file: File, val promise: Promise)

  private val lock = Any()
  private var engine: TextToSpeech? = null
  private var engineState = EngineState.IDLE
  private val waitingForEngine = mutableListOf<(TextToSpeech?) -> Unit>()
  private val jobs = mutableMapOf<String, Job>()

  override fun definition() = ModuleDefinition {
    Name("RoboTts")

    /** Resolves with a file:// URI of a mono PCM WAV. The caller deletes it after reading. */
    AsyncFunction("synthesizeToFile") { text: String, options: SynthesisOptions, promise: Promise ->
      withEngine { tts ->
        if (tts == null) {
          promise.reject(ERROR_CODE, "The phone's text-to-speech engine is not available", null)
        } else {
          synthesize(tts, text, options, promise)
        }
      }
    }

    OnDestroy {
      val pending: List<Job>
      synchronized(lock) {
        engine?.shutdown()
        engine = null
        engineState = EngineState.IDLE
        pending = jobs.values.toList()
        jobs.clear()
      }
      pending.forEach { it.promise.reject(ERROR_CODE, "Text-to-speech was shut down", null) }
    }
  }

  private fun withEngine(block: (TextToSpeech?) -> Unit) {
    val ready: TextToSpeech?
    synchronized(lock) {
      when (engineState) {
        EngineState.READY -> ready = engine
        EngineState.INITIALIZING -> {
          waitingForEngine.add(block)
          return
        }
        EngineState.IDLE -> {
          val context = appContext.reactContext
          if (context == null) {
            ready = null
          } else {
            waitingForEngine.add(block)
            engineState = EngineState.INITIALIZING
            engine = TextToSpeech(context) { status -> onEngineInit(status) }
            return
          }
        }
      }
    }
    block(ready)
  }

  private fun onEngineInit(status: Int) {
    val ready: TextToSpeech?
    val callbacks: List<(TextToSpeech?) -> Unit>
    synchronized(lock) {
      val tts = engine
      if (status == TextToSpeech.SUCCESS && tts != null) {
        tts.setOnUtteranceProgressListener(progressListener)
        engineState = EngineState.READY
        ready = tts
      } else {
        // Leave IDLE so the next call tries again (e.g. after the user installs a voice).
        tts?.shutdown()
        engine = null
        engineState = EngineState.IDLE
        ready = null
      }
      callbacks = waitingForEngine.toList()
      waitingForEngine.clear()
    }
    callbacks.forEach { it(ready) }
  }

  private fun synthesize(tts: TextToSpeech, text: String, options: SynthesisOptions, promise: Promise) {
    val context = appContext.reactContext
    if (context == null) {
      promise.reject(ERROR_CODE, "No Android context", null)
      return
    }
    val dir = File(context.cacheDir, "robo-tts").apply { mkdirs() }
    // Clean up files a crashed or cancelled request left behind.
    val cutoff = System.currentTimeMillis() - STALE_FILE_MS
    dir.listFiles()?.forEach { if (it.lastModified() < cutoff) it.delete() }

    val id = UUID.randomUUID().toString()
    val file = File(dir, "$id.wav")
    synchronized(lock) {
      tts.setPitch(options.pitch)
      tts.setSpeechRate(options.rate)
      tts.setLanguage(resolveLocale(tts, options.language))
      jobs[id] = Job(file, promise)
      val result = tts.synthesizeToFile(text, Bundle(), file, id)
      if (result != TextToSpeech.SUCCESS) {
        jobs.remove(id)
        promise.reject(ERROR_CODE, "Could not start speech synthesis", null)
      }
    }
  }

  private fun resolveLocale(tts: TextToSpeech, languageTag: String?): Locale {
    if (languageTag.isNullOrBlank()) return Locale.getDefault()
    val locale = Locale.forLanguageTag(languageTag)
    // LANG_AVAILABLE (0) and better are usable; negative values mean missing data / unsupported.
    return if (tts.isLanguageAvailable(locale) >= TextToSpeech.LANG_AVAILABLE) locale else Locale.getDefault()
  }

  private fun takeJob(utteranceId: String?): Job? {
    val id = utteranceId ?: return null
    return synchronized(lock) { jobs.remove(id) }
  }

  private fun fail(utteranceId: String?, message: String) {
    val job = takeJob(utteranceId) ?: return
    job.file.delete()
    job.promise.reject(ERROR_CODE, message, null)
  }

  private val progressListener = object : UtteranceProgressListener() {
    override fun onStart(utteranceId: String?) = Unit

    override fun onDone(utteranceId: String?) {
      val job = takeJob(utteranceId) ?: return
      if (job.file.exists() && job.file.length() > 44) {
        job.promise.resolve(Uri.fromFile(job.file).toString())
      } else {
        job.file.delete()
        job.promise.reject(ERROR_CODE, "Speech synthesis produced no audio", null)
      }
    }

    @Deprecated("Deprecated in Android; still abstract so it must be implemented")
    override fun onError(utteranceId: String?) = fail(utteranceId, "Speech synthesis failed")

    override fun onError(utteranceId: String?, errorCode: Int) =
      fail(utteranceId, "Speech synthesis failed (code $errorCode)")

    override fun onStop(utteranceId: String?, interrupted: Boolean) =
      fail(utteranceId, "Speech synthesis stopped")
  }
}

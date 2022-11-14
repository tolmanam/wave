# Form / Audio Annotator
# Use when you need to annotate audio.
# #form #annotator #audio
# ---
from h2o_wave import main, app, Q, ui


@app('/demo')
async def serve(q: Q):
    # Upload the audio file to Wave server first.
    if not q.app.initialized:
        q.app.uploaded_mp3, = await q.site.upload(['audio_annotator_sample.mp3'])
        q.app.initialized = True

    if q.args.annotator is not None:
        q.page['example'].items = [
            ui.text(f'annotator={q.args.annotator}'),
            ui.button(name='back', label='Back', primary=True),
        ]
    else:
        q.page['example'] = ui.form_card(box='1 1 7 -1', items=[
            ui.audio_annotator(
                name='annotator',
                src=q.app.uploaded_mp3,
                tags=[
                    ui.audio_annotator_tag(name='m', label='Flute', color='$blue'),
                    ui.audio_annotator_tag(name='f', label='Drum', color='$brown'),
                ],
            ),
            ui.button(name='submit', label='Submit', primary=True)
        ])
    await q.page.save()

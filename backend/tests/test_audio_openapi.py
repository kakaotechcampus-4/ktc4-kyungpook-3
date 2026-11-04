from app.main import app


def test_audio_openapi_declares_audio_media_type():
    schema = app.openapi()
    content = schema["paths"]["/api/v1/meetings/{meeting_id}/audio"]["get"]["responses"]["200"]["content"]
    assert "audio/*" in content
    assert "application/octet-stream" not in content

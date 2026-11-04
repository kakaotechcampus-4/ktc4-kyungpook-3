from app.services import upload_storage


def test_playback_types_cover_every_supported_extension():
    # 업로드 확장자를 늘리고 재생 Content-Type 을 빠뜨리면 octet-stream 으로 나간다
    assert set(upload_storage.PLAYBACK_CONTENT_TYPES) == set(upload_storage.SUPPORTED_EXTENSIONS)
    assert all(v.startswith("audio/") for v in upload_storage.PLAYBACK_CONTENT_TYPES.values())

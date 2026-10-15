import server

M1 = {"h264": "avc", "hevc": "hvc|hev"}
M3 = {**M1, "av1": "av01"}
JOB = {"url": "https://www.instagram.com/reel/abc/"}


def settings(**overrides: object) -> dict:
    return {**server.DEFAULTS, "folder": "/Users/test/Movies", **overrides}


def test_parse_version_orders_numerically() -> None:
    assert server.parse_version("0.10.0") > server.parse_version("0.9.9")
    assert server.parse_version("v1.2") == (1, 2)
    assert server.parse_version(None) == ()


def test_av1_decoder_starts_at_m3() -> None:
    assert not server.has_av1_decoder("Apple M2 Pro")
    assert server.has_av1_decoder("Apple M3")
    assert server.has_av1_decoder("Apple M10 Max")
    assert not server.has_av1_decoder("Intel(R) Core(TM) i9")


def test_native_format_lists_only_playable_codecs() -> None:
    assert "av01" not in server.native_format(M1)
    assert "av01" in server.native_format(M3)
    assert "vp9" not in server.native_format(M3)


def test_compat_mode_prefers_h264_before_resolution() -> None:
    cmd = server.command(JOB, settings(codec="compat"), M3)
    assert cmd[cmd.index("-S") + 1] == "vcodec:h264,res,acodec:aac"
    assert "-f" not in cmd


def test_auto_mode_filters_codecs_then_sorts_by_resolution() -> None:
    cmd = server.command(JOB, settings(codec="auto", quality="720"), M1)
    assert cmd[cmd.index("-f") + 1] == server.native_format(M1)
    assert cmd[cmd.index("-S") + 1] == "res:720,vcodec,acodec:aac"
    assert cmd[cmd.index("--merge-output-format") + 1] == "mp4"


def test_audio_quality_extracts_m4a_without_video_sorting() -> None:
    cmd = server.command(JOB, settings(quality="audio"), M1)
    assert cmd[cmd.index("--audio-format") + 1] == "m4a"
    assert "-S" not in cmd


def test_site_folders_and_cookies_are_opt_in() -> None:
    plain = server.command(JOB, settings(), M1)
    assert plain[plain.index("-P") + 1] == "/Users/test/Movies"
    assert "--cookies-from-browser" not in plain
    custom = server.command(JOB, settings(by_site=True, cookies=True), M1)
    assert custom[custom.index("-P") + 1] == "/Users/test/Movies/instagram.com"
    assert "--cookies-from-browser" in custom


def test_url_is_passed_after_the_option_terminator() -> None:
    cmd = server.command(JOB, settings(), M1)
    assert cmd[-2:] == ["--", JOB["url"]]


def test_clean_settings_rejects_unknown_values() -> None:
    cleaned = server.clean_settings({"quality": "4k", "concurrent": 9, "codec": "vp9", "by_site": "yes"}, settings())
    assert cleaned == settings()


def test_clean_settings_migrates_legacy_codec_values() -> None:
    assert server.clean_settings({"codec": "quality"}, settings())["codec"] == "auto"
    assert server.clean_settings({"compat": True}, settings(codec="auto"))["codec"] == "compat"
    assert server.clean_settings({"compat": False}, settings(codec="compat"))["codec"] == "auto"


def test_clean_settings_keeps_folders_inside_home_or_volumes_only() -> None:
    home = str(server.HOME / "Movies")
    assert server.clean_settings({"folder": home}, settings())["folder"] == home
    assert server.clean_settings({"folder": "/Volumes/Disk/Videos"}, settings())["folder"] == "/Volumes/Disk/Videos"
    assert server.clean_settings({"folder": "/etc"}, settings())["folder"] == "/Users/test/Movies"
    assert server.clean_settings({"folder": f"{server.HOME}/../../etc"}, settings())["folder"] == "/Users/test/Movies"


def test_progress_percent_prefers_bytes_then_falls_back_to_fragments() -> None:
    assert server.progress_percent("@@50/100/NA/NA/NA") == 50
    assert server.progress_percent("@@50/NA/200/NA/NA") == 25
    assert server.progress_percent("@@NA/NA/NA/3/12") == 25
    assert server.progress_percent("@@NA/NA/NA/NA/NA") is None


def test_writes_require_the_extension_origin() -> None:
    host = f"127.0.0.1:{server.PORT}"
    assert server.is_allowed("safari-web-extension://abc", host, write=True)
    assert server.is_allowed("chrome-extension://abc", host, write=True)
    assert not server.is_allowed("https://evil.example", host, write=True)
    assert not server.is_allowed(None, host, write=True)


def test_reads_without_origin_need_the_local_host_header() -> None:
    assert server.is_allowed(None, f"127.0.0.1:{server.PORT}", write=False)
    assert server.is_allowed(None, f"localhost:{server.PORT}", write=False)
    assert not server.is_allowed(None, "attacker.example", write=False)
    assert not server.is_allowed("https://evil.example", f"127.0.0.1:{server.PORT}", write=False)


def test_unknown_routes_return_not_found() -> None:
    assert server.route("GET", ["nope"], {})[0] == 404
    assert server.route("DELETE", ["jobs"], {})[0] == 404


def test_cookies_come_from_the_requesting_browser() -> None:
    cmd = server.command({**JOB, "browser": server.browser_for("chrome-extension://abc")}, settings(cookies=True), M1)
    assert cmd[cmd.index("--cookies-from-browser") + 1] == "chrome"
    assert server.browser_for("safari-web-extension://abc") == "safari"
    assert server.browser_for(None) == "safari"

"""최대 RSS 단위. macOS 는 바이트, Linux 는 KiB 다."""

from collections import namedtuple

from stt.eval.sysinfo import peak_rss_bytes

Usage = namedtuple("Usage", "ru_maxrss")


def test_linux_reports_kib_and_darwin_reports_bytes():
    assert peak_rss_bytes(Usage(1_048_576), platform="linux") == 1_048_576 * 1024     # 1 GiB
    assert peak_rss_bytes(Usage(1_048_576), platform="darwin") == 1_048_576            # 1 MiB
    assert peak_rss_bytes(Usage(3), platform="linux2") == 3 * 1024


def test_default_uses_the_running_process():
    assert peak_rss_bytes() > 0

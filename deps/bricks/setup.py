from setuptools import setup, find_packages

setup(
    name="bricks",
    version="0.1.0",
    packages=find_packages(),
    py_modules=["bricks"],
    install_requires=[
        "requests",
        "dnspython",
    ],
    entry_points={
        "console_scripts": [
            "bricks=bricks:main",
        ],
    },
)

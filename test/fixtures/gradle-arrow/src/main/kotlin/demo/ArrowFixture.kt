package demo

import arrow.core.Either

fun arrowFixtureValue(): Either<String, Int> = Either.Right(42)
